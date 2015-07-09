/**
 * partty.js
 * Copyright (c) 2015, James M. Greene (MIT License)
 * Copyright (c) 2012-2015, Christopher Jeffrey (MIT License)
 * Binding to the pseudo terminals.
 */

var extend = require('extend');
var pty = require('../build/Release/pty.node');
var net = require('net');
var tty = require('tty');

var version = process.versions.node.split('.').map(function(n) {
  return +(n + '').split('-')[0];
});

var DEFAULT_COLS = 80;
var DEFAULT_ROWS = 24;


/**
 * Terminal
 */

// Example:
//  var term = new Terminal('bash', [], {
//    name: 'xterm-color',
//    cols: 80,
//    rows: 24,
//    cwd: process.env.HOME,
//    env: process.env
//  });

function Terminal(file, args, opts) {
  if (!(this instanceof Terminal)) {
    return new Terminal(file, args, opts);
  }

  var env, cwd, name, cols, rows, currentCols, currentRows, term,
      self = this;

  // backward compatibility
  if (typeof args === 'string') {
    opts = {
      name: arguments[1],
      cols: arguments[2],
      rows: arguments[3],
      cwd:  process.env.HOME
    };
    args = [];
  }

  // arguments
  args = args || [];
  file = file || 'sh';
  opts = opts || {};

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

  opts.env = opts.env || process.env || {};
  env = extend({}, opts.env);

  if (opts.env === process.env) {
    // Make sure we didn't start our server from inside tmux.
    delete env.TMUX;
    delete env.TMUX_PANE;

    // Make sure we didn't start our server from inside screen.
    // http://web.mit.edu/gnu/doc/html/screen_20.html
    delete env.STY;
    delete env.WINDOW;

    // Delete some variables that might confuse our terminal.
    delete env.WINDOWID;
    delete env.TERMCAP;
    delete env.COLUMNS;
    delete env.LINES;
  }

  // We could set some basic env vars here, if they do not exist:
  // USER, SHELL, HOME, LOGNAME, WINDOWID

  cwd = opts.cwd || process.cwd();
  name = opts.name || env.TERM || 'xterm';
  env.TERM = name;
  env.LINES = rows + '';
  env.COLUMNS = cols + '';

  env = environ(env);


  // fork
  term = opts.uid && opts.gid ?
    pty.fork(file, args, env, cwd, cols, rows, opts.uid, opts.gid) :
    pty.fork(file, args, env, cwd, cols, rows);

  this.socket = new TTYStream(term.fd);
  this.socket.setEncoding('utf8');
  this.socket.resume();


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


  // setup
  this.socket.on('error', function(err) {
    // NOTE: fs.ReadStream gets EAGAIN twice at first:
    if (err.code) {
      if (err.code.indexOf('EAGAIN') > -1) {
        return;
      }
    }

    // close
    self._close();
    // EIO on exit from fs.ReadStream:
    if (!self._emittedExit) {
      self._emittedExit = true;
      Terminal.total--;
      self.emit('exit', null);
    }

    // EIO, happens when someone closes our child process: the only process in the terminal.
    // node  < 0.6.14: errno 5
    // node >= 0.6.14: read EIO
    if (err.code) {
      if (err.code.indexOf('errno 5') > -1 || err.code.indexOf('EIO') > -1) {
        return;
      }
    }

    // throw anything else
    if (self.listeners('error').length < 2) {
      throw err;
    }
  });

  this.pid = term.pid;
  this.fd  = term.fd;
  this.pty = term.pty;

  this.file = file;
  this.name = name;
  this.cols = cols;
  this.rows = rows;

  this.readable = true;
  this.writable = true;

  Terminal.total++;

  // XXX This never gets emitted with v0.12.0
  this.socket.on('close', function() {
    if (self._emittedExit) {
      return;
    }
    self._emittedExit = true;
    Terminal.total--;
    self._close();
    self.emit('exit', null);
  });

  env = null;
}

Terminal.fork =
Terminal.spawn =
Terminal.createTerminal = function(file, args, opts) {
  return new Terminal(file, args, opts);
};

/**
 * openpty
 */

Terminal.open = function(opts) {
  opts = opts || {};

  if (arguments.length > 1) {
    opts = {
      cols: arguments[1],
      rows: arguments[2]
    };
  }

  var self = Object.create(Terminal.prototype),
      cols = isValidPositiveInteger(opts.cols) ? opts.cols : DEFAULT_COLS,
      rows = isValidPositiveInteger(opts.rows) ? opts.rows : DEFAULT_ROWS,
      term;

  // open
  term = pty.open(cols, rows);

  self.master = new TTYStream(term.master);
  self.master.setEncoding('utf8');
  self.master.resume();

  self.slave = new TTYStream(term.slave);
  self.slave.setEncoding('utf8');
  self.slave.resume();

  self.socket = self.master;
  self.pid = null;
  self.fd  = term.master;
  self.pty = term.pty;

  self.file = process.argv[0] || 'node';
  self.name = process.env.TERM || '';
  self.cols = cols;
  self.rows = rows;

  self.readable = true;
  self.writable = true;

  self.socket.on('error', function(err) {
    Terminal.total--;
    self._close();
    if (self.listeners('error').length < 2) {
      throw err;
    }
  });

  Terminal.total++;
  self.socket.on('close', function() {
    Terminal.total--;
    self._close();
  });

  return self;
};

/**
 * Total
 */

// Keep track of the total number of terminals for the process.
Terminal.total = 0;

/**
 * Events
 */

Terminal.prototype.write = function(data) {
  return this.socket.write(data);
};

Terminal.prototype.end = function(data) {
  return this.socket.end(data);
};

Terminal.prototype.pipe = function(dest, options) {
  return this.socket.pipe(dest, options);
};

Terminal.prototype.pause = function() {
  return this.socket.pause();
};

Terminal.prototype.resume = function() {
  return this.socket.resume();
};

Terminal.prototype.setEncoding = function(enc) {
  if (this.socket._decoder) {
    delete this.socket._decoder;
  }
  if (enc) {
    this.socket.setEncoding(enc);
  }
};

Terminal.prototype.addListener =
Terminal.prototype.on = function(type, func) {
  this.socket.on(type, func);
  return this;
};

Terminal.prototype.emit = function() {
  return this.socket.emit.apply(this.socket, arguments);
};

Terminal.prototype.listeners = function(type) {
  return this.socket.listeners(type);
};

Terminal.prototype.removeListener = function(type, func) {
  this.socket.removeListener(type, func);
  return this;
};

Terminal.prototype.removeAllListeners = function(type) {
  this.socket.removeAllListeners(type);
  return this;
};

Terminal.prototype.once = function(type, func) {
  this.socket.once(type, func);
  return this;
};

Object.defineProperty(
  Terminal.prototype,
  'stdin',
  {
    get: function() {
      return this;
    }
  }
);

Object.defineProperty(
  Terminal.prototype,
  'stdout',
  {
    get: function() {
      return this;
    }
  }
);

Object.defineProperty(
  Terminal.prototype,
  'stderr',
  {
    get: function() {
      throw new Error('No stderr.');
    }
  }
);


/**
 * TTY
 */

Terminal.prototype.resize = function(cols, rows) {
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

  pty.resize(this.fd, cols, rows);
};

Terminal.prototype.destroy = function() {
  var self = this;

  // Unconfigure "snap" currying, if enabled
  if (opts.snap === true && process.stdout.isTTY === true) {

    // Stop currying all data received from the pseudo terminal to `process.stdout`
    self.unpipe(process.stdout);

    // Stop currying all data received from `process.stdin` to the pseudo terminal
    process.stdin.pause();
    process.stdin.unpipe(self);
  }

  // close
  this._close();

  // Need to close the read stream so
  // node stops reading a dead file descriptor.
  // Then we can safely SIGHUP the shell.
  this.socket.once('close', function() {
    self.kill('SIGHUP');
  });

  this.socket.destroy();
};

Terminal.prototype.kill = function(sig) {
  try {
    process.kill(this.pid, sig || 'SIGHUP');
  }
  catch(e) {
    // Do nothing...
  }
};

Terminal.prototype.redraw = function() {
  var self = this,
      cols = this.cols,
      rows = this.rows;

  // We could just send SIGWINCH, but most programs will
  // ignore it if the size hasn't actually changed.

  this.resize(cols + 1, rows + 1);

  setTimeout(function() {
    self.resize(cols, rows);
  }, 30);
};

Object.defineProperty(
  Terminal.prototype,
  'process',
  {
    get: function() {
      return pty.process(this.fd, this.pty) || this.file;
    }
  }
);

Terminal.prototype._close = function() {
  this.socket.writable = false;
  this.socket.readable = false;
  this.write = function() {};
  this.end = function() {};
  this.writable = false;
  this.readable = false;
};

/**
 * TTY Stream
 */

function TTYStream(fd) {
  // Could use: if (!require('tty').ReadStream)
  if (version[0] === 0 && version[1] < 7) {
    return new net.Socket(fd);
  }

  if (version[0] === 0 && version[1] < 12) {
    return new tty.ReadStream(fd);
  }

  return new Socket(fd);
}

/**
 * Wrap net.Socket for a workaround
 */

function Socket(options) {
  if (!(this instanceof Socket)) {
    return new Socket(options);
  }
  var tty = process.binding('tty_wrap');
  var guessHandleType = tty.guessHandleType;
  tty.guessHandleType = function() {
    return 'PIPE';
  };
  net.Socket.call(this, options);
  tty.guessHandleType = guessHandleType;
}

if (Object.setPrototypeOf) {
  Object.setPrototypeOf(
    Socket.prototype,
    net.Socket.prototype
  );
}
else {
  Socket.prototype._proto_ = net.Socket.prototype;
}

/**
 * Helpers
 */

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
