/*jshint node:true, maxstatements: false, maxlen: false */

module.exports = function(grunt) {
  "use strict";

  // Load necessary tasks
  grunt.loadNpmTasks("grunt-contrib-jshint");

  // Project configuration.
  var config = {
    // Task configuration
    jshint: {
      options: {
        jshintrc: true
      },
      gruntfile: ["Gruntfile.js"],
      src: ["!Gruntfile.js", "*.js", "lib/**/*.js"],
      test: ["test/**/*.js"]
    }
  };
  grunt.initConfig(config);


  // Default task
  grunt.registerTask("default", ["jshint"]);

  // Test task
  grunt.registerTask("test", ["jshint"]);

};
