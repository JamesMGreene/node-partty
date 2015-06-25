/**
 * partty_win.js
 * Copyright (c) 2015, James M. Greene (MIT License)
 * Copyright (c) 2012-2015, Christopher Jeffrey, Peter Sunde (MIT License)
 * Binding to the pseudo terminals for Windows.
 */

var net = require('net');
var path = require('path');
var extend = require('extend');
var inherits = require('util').inherits;
var BaseTerminal = require('./partty').Terminal;
var pty = require('../build/Release/pty.node');

// Counter of number of "pipes" created so far.
var pipeIncr = 0;

var DEFAULT_COLS = 80;
var DEFAULT_ROWS = 30;


/**
 * Agent. Internal class.
 *
 * Everytime a new pseudo terminal is created it is contained
 * within agent.exe. When this process is started there are two
 * available named pipes (control and data socket).
 */

function Agent(file, args, env, cwd, cols, rows, debug) {
  var self = this;

  // Increment the number of pipes created.
  pipeIncr++;

  // Unique identifier per pipe created.
  var timestamp = Date.now();

  // The data pipe is the direct connection to the forked terminal.
  this.dataPipe = '\\\\.\\pipe\\winpty-data-' + pipeIncr + '' + timestamp;

  // Dummy socket for awaiting `ready` event.
  this.ptySocket = new net.Socket();

  // Create terminal pipe IPC channel and forward
  // to a local unix socket.
  this.ptyDataPipe = net.createServer(function(socket) {

    // Default socket encoding.
    socket.setEncoding('utf8');

    // Pause until `ready` event is emitted.
    socket.pause();

    // Sanitize input variable.
    file = file;
    args = args.join(' ');
    cwd = path.resolve(cwd);

    // Start terminal session.
    pty.startProcess(self.pid, file, args, env, cwd);

    // Emit ready event.
    self.ptySocket.emit('ready_datapipe', socket);

  }).listen(this.dataPipe);

  // Open pty session.
  var term = pty.open(self.dataPipe, cols, rows, debug);

  // Terminal pid.
  this.pid = term.pid;

  // Not available on windows.
  this.fd = term.fd;

  // Generated incremental number that has no real purpose besides
  // using it as a terminal id.
  this.pty = term.pty;
}

/**
 * Terminal
 */

/*
var pty = require('./');

var term = pty.fork('cmd.exe', [], {
  name:  'Windows Shell',
  cols:  80,
  rows:  30,
  cwd:   process.env.HOME,
  env:   process.env,
  debug: true
});

term.on('data', function(data) {
  console.log(data);
});
*/

function Terminal(file, args, opts) {
  if (!(this instanceof Terminal)) {
    return new Terminal(file, args, opts);
  }

  var env, cwd, name, cols, rows, currentCols, currentRows, debug,
      self = this;

  // Backward compatibility.
  if (typeof args === 'string') {
    opts = {
      name: arguments[1],
      cols: arguments[2],
      rows: arguments[3],
      cwd:  process.env.HOME
    };
    args = [];
  }

  // Arguments.
  args = args || [];
  file = file || 'cmd.exe';
  opts = opts || {};

  env = extend({}, opts.env);


  if (opts.snap === true && process.stdout.isTTY === true) {

    // Establish the default columns and rows based on the TTY dimensions
    // of `process.stdout`
    if (isValidPositiveInteger(process.stdout.columns)) {
      currentCols = process.stdout.columns;
    }
    if (isValidPositiveInteger(process.stdout.rows)) {
      currentRows = process.stdout.rows;
    }

  }

  cols = isValidPositiveInteger(opts.cols) ? opts.cols : (currentCols || DEFAULT_COLS);
  rows = isValidPositiveInteger(opts.rows) ? opts.rows : (currentRows || DEFAULT_ROWS);

  cwd  = opts.cwd || process.cwd();
  name = opts.name || env.TERM || 'Windows Shell';
  debug = opts.debug || false;

  env.TERM = name;

  // Initialize environment variables.
  env = environ(env);

  // If the terminal is ready
  this.isReady = false;

  // Functions that need to run after `ready` event is emitted.
  this.deferreds = [];

  // Create new terminal.
  this.agent = new Agent(file, args, env, cwd, cols, rows, debug);

  // The dummy socket is used so that we can defer everything
  // until its available.
  this.socket = this.agent.ptySocket;


  // Configure "snap" currying, if enabled
  if (opts.snap === true && process.stdout.isTTY === true) {

    if (
      (currentCols && currentRows && cols === currentCols && rows === currentRows === rows) ||
      (cols === DEFAULT_COLS && rows === DEFAULT_ROWS)
    ) {
      // Delay for 1 cycle just to ensure that the "resize" event doesn't
      // trigger when the terminal is first opened
      process.nextTick(function() {
        // Automatically resize to match the TTY dimensions of `process.stdout`
        process.stdout.on('resize', function() {
          self.resize(process.stdout.columns, process.stdout.rows);
        });
      });
    }

    // Curry all data received from the pseudo terminal to `process.stdout`
    self.pipe(process.stdout);

    // Curry all data received from `process.stdin` to the pseudo terminal
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.pipe(self);

  }


  // The terminal socket when its available
  this.dataPipe = null;

  // Not available until `ready` event emitted.
  this.pid = this.agent.pid;
  this.fd = this.agent.fd;
  this.pty = this.agent.pty;

  // The forked windows terminal is not available
  // until `ready` event is emitted.
  this.socket.on('ready_datapipe', function(socket) {

    // Set terminal socket
    self.dataPipe = socket;

    // These events needs to be forwarded.
    ['connect', 'data', 'end', 'timeout', 'drain'].forEach(function(event) {
      self.dataPipe.on(event, function(data) {

        // Wait until the first data event is fired
        // then we can run deferreds.
        if(!self.isReady && event === 'data') {

          // Terminal is now ready and we can
          // avoid having to defer method calls.
          self.isReady = true;

          // Execute all deferred methods
          self.deferreds.forEach(function(fn) {
            // NB! In order to ensure that `this` has all
            // its references updated any variable that
            // need to be available in `this` before
            // the deferred is run has to be declared
            // above this forEach statement.
            fn.run();
          });

          // Reset
          self.deferreds = [];

        }

        // Emit to dummy socket
        self.socket.emit(event, data);

      });
    });

    // Resume socket.
    self.dataPipe.resume();

    // Shutdown if `error` event is emitted.
    self.dataPipe.on('error', function(err) {

      // Close terminal session.
      self._close();

      // EIO, happens when someone closes our child
      // process: the only process in the terminal.
      // node < 0.6.14: errno 5
      // node >= 0.6.14: read EIO
      if (err.code) {
        if (err.code.indexOf('errno 5') > -1 || err.code.indexOf('EIO') > -1) {
          return;
        }
      }

      // Throw anything else.
      if (self.listeners('error').length < 2) {
        throw err;
      }

    });

    // Cleanup after the socket is closed.
    self.dataPipe.on('close', function () {
      Terminal.total--;
      self.emit('exit', null);
      self._close();
    });

  });

  this.file = file;
  this.name = name;
  this.cols = cols;
  this.rows = rows;

  this.readable = true;
  this.writable = true;

  Terminal.total++;
}

Terminal.fork =
Terminal.spawn =
Terminal.createTerminal = function(file, args, opts) {
  return new Terminal(file, args, opts);
};

// Inherit from pty.js
inherits(Terminal, BaseTerminal);

// Keep track of the total
// number of terminals for
// the process.
Terminal.total = 0;

/**
 * Events
 */

/**
 * openpty
 */

Terminal.open = function () {
  throw new Error('open() not supported on windows, use Fork() instead.');
};

/**
 * Events
 */

Terminal.prototype.write = function(data) {
  defer(this, function() {
    this.dataPipe.write(data);
  });
};

/**
 * TTY
 */

Terminal.prototype.resize = function(cols, rows) {
  defer(this, function() {
    cols = isValidPositiveInteger(cols) ? cols : (isValidPositiveInteger(this.cols) ? this.cols : DEFAULT_COLS);
    rows = isValidPositiveInteger(rows) ? rows : (isValidPositiveInteger(this.rows) ? this.rows : DEFAULT_ROWS);

    this.cols = cols;
    this.rows = rows;

    //
    // TODO: Figure out if there is any way to update the environment of an existing pseudo terminal...?
    //
    //env.LINES = rows + '';
    //env.COLUMNS = cols + '';
    //env = environ(env);

    pty.resize(this.pid, cols, rows);
  });
};

Terminal.prototype.destroy = function () {
  defer(this, function() {
    this.kill();
  });
};

Terminal.prototype.kill = function(sig) {
  defer(this, function() {
    if (sig !== undefined) {
      throw new Error('Signals not supported on windows.');
    }
    this._close();
    pty.kill(this.pid);
  });
};

Object.defineProperty(
  Terminal.prototype,
  'process',
  {
    get: function() {
      return this.name;
    }
  }
);

/**
 * Helpers
 */

function defer(terminal, deferredFn) {

  // Ensure that this method is only used within Terminal class.
  if (!(terminal instanceof Terminal)) {
    throw new Error('Must be instanceof Terminal');
  }

  // If the terminal is ready, execute.
  if (terminal.isReady) {
    deferredFn.apply(terminal, null);
    return;
  }

  // Queue until terminal is ready.
  terminal.deferreds.push({
    run: function() {
      // Run deffered.
      deferredFn.apply(terminal, null);
    }
  });
}

function environ(env) {
  var keys = Object.keys(env || {}),
      l = keys.length,
      i = 0,
      pairs = [];

  for (; i < l; i++) {
    pairs.push(keys[i] + '=' + env[keys[i]]);
  }

  return pairs;
}

function isValidPositiveInteger(num) {
  return (
    typeof num === 'number' &&
    !isNaN(num) &&
    num > 0 &&
    num !== Infinity &&
    parseInt(num, 10) === num
  );
}


/**
 * Expose
 */

module.exports = exports = Terminal;
exports.Terminal = Terminal;
exports['native'] = pty;
