/*eslint-env node */

import path from 'path';
const mod_path = path.join('.', 'node_modules');
const bin_path = path.join(mod_path, '.bin');
const nyc_path = path.join(bin_path, 'nyc');

export default function (grunt) {
    grunt.initConfig({
        eslint: {
            target: [
                '*.js',
                'test/**/*.js',
                '!test/fixtures/axios.min.js',
                '!test/fixtures/jsrsasign-all-min.js',
                '!test/fixtures/ajv.min.js'
            ]
        },

        exec: {
            test: 'node -r esm ./node_modules/.bin/wdio',
            wdio_cleanup: './test/wdio_cleanup.sh',

            cover: `${nyc_path} --require esm -x wdio.conf.js -x 'test/**' ./node_modules/.bin/wdio`,
            cover_report: `${nyc_path} report -r lcov`,
            cover_check: `${nyc_path} check-coverage --statements 100 --branches 100 --functions 100 --lines 100`
        },

        fileWrap: {
            axios: {
                header: 'export default (function () {',
                footer: '\nreturn this.axios; }).call({});',
                files: {
                    './test/fixtures/axios.min.js': './node_modules/axios/dist/axios.min.js'
                },
                options: {
                    skipCheck: true
                }
            },

            jsrsasign: {
                header: 'export default (function () {',
                footer: '\nreturn KJUR; }).call({});',
                files: {
                    './test/fixtures/jsrsasign-all-min.js': './node_modules/jsrsasign/lib/jsrsasign-all-min.js'
                },
                options: {
                    skipCheck: true
                }
            },

            ajv: {
                header: 'export default (function () {',
                footer: '\nreturn Ajv; }).call({});',
                files: {
                    './test/fixtures/ajv.min.js': './node_modules/ajv/dist/ajv.min.js'
                },
                options: {
                    skipCheck: true
                }

            }

        }
    });

    grunt.loadNpmTasks('grunt-eslint');
    grunt.loadNpmTasks('grunt-exec');
    grunt.loadNpmTasks('grunt-force-task');
    grunt.loadNpmTasks('grunt-file-wrap');

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
}
