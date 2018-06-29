/*eslint-env node */
module.exports = function (grunt) {
    grunt.initConfig({
        eslint: {
            target: ['*.js', 'test/**/*.js']
        },

        mochaTest: {
            cred: 'test/cred.js'
        },

        exec: {
            test_cred: './node_modules/.bin/wdio'
        }
    });

    grunt.loadNpmTasks('grunt-eslint');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-exec');

    grunt.registerTask('lint', 'eslint');
    grunt.registerTask('test-cred', process.env.CI === 'true' ? 'mochaTest:cred' : 'exec:test_cred');
    grunt.registerTask('test', 'test-cred');
};