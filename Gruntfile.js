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
            test_cred: './node_modules/.bin/wdio',
            wdio_cleanup: './test/wdio_cleanup.sh'
        }
    });

    grunt.loadNpmTasks('grunt-eslint');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-exec');
    grunt.loadNpmTasks('grunt-force-task');

    grunt.registerTask('lint', 'eslint');
    grunt.registerTask('test-cred',
        process.env.CI === 'true' ?
            'mochaTest:cred' : [
                'force:exec:test_cred',
                // work around https://github.com/webdriverio/wdio-selenium-standalone-service/issues/28
                // (https://github.com/vvo/selenium-standalone/issues/351)
                'exec:wdio_cleanup',
                'exit_with_test_cred_status'
            ]);
    grunt.registerTask('test', 'test-cred');

    grunt.registerTask('exit_with_test_cred_status', function () {
        this.requires(['exec:test_cred']);
        return true;
    });
};