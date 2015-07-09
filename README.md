[![Build Status](https://travis-ci.org/JamesMGreene/node-partty.svg?branch=master)](https://travis-ci.org/JamesMGreene/node-partty) [![NPM version](https://badge.fury.io/js/partty.svg)](https://www.npmjs.com/package/partty)
# ParTTY

Pseudo terminals for Node.js, with smart defaults.

## Overview

These are `forkpty(3)` bindings for Node.js, which allows you to fork processes with pseudo terminal file descriptors. It returns a terminal object which allows for reading and writing.

This is useful for:
 - Writing a terminal emulator.
 - Getting certain programs to _think_ you're a terminal. This is useful if you need a program to send you control sequences.


## Example Usages

### Leveraging Smart Defaults

```js
var ParTTY = require('partty');

// To leverage the smart defaults for sizing based on `process.stdout`,
// set the option `snap` to `true`:
var term = ParTTY.spawn('bash', [], { snap: true });

console.log('Launched ' + term.process + ' with PID ' + term.pid);

term.write('ls\r');
term.resize(100, 40);
term.write('ls /\r');
```


### Exerting Manual Control

```js
var ParTTY = require('partty');

var term =
  ParTTY.spawn(
    'bash',
    [],
    {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd:  process.env.HOME,
      env:  process.env
    }
  );

term.on('data', function(data) {
  process.stdout.write(data);
});

console.log('Launched ' + term.process + ' with PID ' + term.pid);

term.write('ls\r');
term.resize(100, 40);
term.write('ls /\r');
```


## TODO

 - Add tcsetattr(3), tcgetattr(3).
 - Add a way of determining the current foreground job for platforms other than Linux and OSX/Darwin.


## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`


## License

Copyright (c) 2015, James M. Greene (MIT License).
Copyright (c) 2012-2015, Christopher Jeffrey (MIT License).
