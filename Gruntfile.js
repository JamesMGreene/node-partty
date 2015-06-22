/*jshint node:true, maxstatements: false, maxlen: false */

module.exports = function(grunt) {
  "use strict";

  // Load necessary tasks
  grunt.loadNpmTasks("grunt-contrib-jshint");
  grunt.loadNpmTasks("grunt-mocha-cli");

  // Project configuration.
  var config = {

    // Task configuration
    jshint: {
      options: {
        jshintrc: true
      },
      gruntfile: ["Gruntfile.js"],
      src: ["!Gruntfile.js", "!lib/partty2*.js", "*.js", "lib/partty.js", "lib/partty_win.js"],
      test: ["test/**/*.js"]
    },

    mochacli: {
      test: {
        options: {
          "check-leaks": true,
          ui: "bdd",
          reporter: "spec"
        },
        all: ["test/**/*.js"]
      }
    }
  };

  grunt.initConfig(config);


  // Default task
  grunt.registerTask("default", ["jshint", "mochacli"]);

  // Travis CI task
  grunt.registerTask("travis", ["jshint", "mochacli"]);

};
