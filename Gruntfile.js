/*eslint-env node */

const path = require('path');
const mod_path = path.join('.', 'node_modules');
const bin_path = path.join(mod_path, '.bin');
const nyc_path = path.join(bin_path, 'nyc');
const grunt_path = process.platform === 'win32' ?
    path.join(mod_path, 'grunt', 'bin', 'grunt') :
    path.join(bin_path, 'grunt');

module.exports = function (grunt) {
    grunt.initConfig({
        eslint: {
            target: [
                '*.js',
                'test/**/*.js',
                '!test/fixtures/axios.min.js',
                '!test/fixtures/jsrsasign-all-min.js'
            ]
        },

        exec: {
            test: './node_modules/.bin/wdio',
            wdio_cleanup: './test/wdio_cleanup.sh',

            cover: `${nyc_path} -x Gruntfile.js -x 'test/**' node ${grunt_path} test`,
            cover_report: `${nyc_path} report -r lcov`,
            cover_check: `${nyc_path} check-coverage --statements 100 --branches 100 --functions 100 --lines 100`
        }
    });

    grunt.loadNpmTasks('grunt-eslint');
    grunt.loadNpmTasks('grunt-exec');
    grunt.loadNpmTasks('grunt-force-task');

    grunt.registerTask('lint', 'eslint');

    grunt.registerTask('test', [
        'force:exec:test',
        // work around https://github.com/webdriverio/wdio-selenium-standalone-service/issues/28
        // (https://github.com/vvo/selenium-standalone/issues/351)
        'exec:wdio_cleanup',
        'exit_with_test_status'
    ]);

    grunt.registerTask('coverage', [
        'exec:cover',
        'exec:cover_report',
        'exec:cover_check'
    ]);

    grunt.registerTask('exit_with_test_status', function () {
        this.requires(['exec:test']);
        return true;
    });
};
