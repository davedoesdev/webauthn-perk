/*eslint-env node */

import path from 'path';
import load_grunt_tasks from 'load-grunt-tasks';

const mod_path = path.join('.', 'node_modules');
const bin_path = path.join(mod_path, '.bin');
const c8_path = path.join(bin_path, 'c8');
const wdio_path = path.join(bin_path, 'wdio');

export default function (grunt) {
    grunt.initConfig({
        eslint: {
            target: [
                '*.js',
                'test/**/*.js',
                'dist/**/*.js',
                '!dist/axios.js',
                '!dist/jsrsasign-all-min.js',
                '!dist/ajv.bundle.js'
            ]
        },

        exec: {
            test: `node -r esm ${wdio_path}`,
            wdio_cleanup: './test/wdio_cleanup.sh',

            cover: `${c8_path} -x wdio.conf.js -x 'test/**' node -r esm ${wdio_path}`,
            cover_report: `${c8_path} report -r lcov`,
            cover_check: `${c8_path} check-coverage --statements 100 --branches 100 --functions 100 --lines 100`
        },

        fileWrap: {
            axios: {
                header: 'export default (function () {',
                footer: '\nreturn this.axios; }).call({});',
                files: {
                    './dist/axios.js': path.join(path.dirname(require.resolve('axios')), 'dist', 'axios.js')
                },
                options: {
                    skipCheck: true
                }
            },

            jsrsasign: {
                header: 'export default (function () {',
                footer: '\nreturn KJUR; }).call({});',
                files: {
                    './dist/jsrsasign-all-min.js': path.join(path.dirname(require.resolve('jsrsasign')), 'jsrsasign-all-min.js')
                },
                options: {
                    skipCheck: true
                }
            },

            ajv: {
                header: 'export default (function () {',
                footer: '\nreturn Ajv; }).call({});',
                files: {
                    './dist/ajv.bundle.js': path.join(path.dirname(require.resolve('ajv')), '..', 'dist', 'ajv.bundle.js')
                },
                options: {
                    skipCheck: true
                }
            }
        }
    });

    load_grunt_tasks(grunt, {
        pattern: 'grunt-file-wrap',
        requireResolution: true
    });

    if ((grunt.cli.tasks.length !== 1) || (grunt.cli.tasks[0] !== 'fileWrap')) {
        grunt.loadNpmTasks('grunt-eslint');
        grunt.loadNpmTasks('grunt-exec');
        grunt.loadNpmTasks('grunt-force-task');
    }

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
        'force:exec:cover_check',
        'exec:wdio_cleanup',
        'exit_with_coverage_status'
    ]);

    grunt.registerTask('exit_with_test_status', function () {
        this.requires(['exec:test']);
        return true;
    });

    grunt.registerTask('exit_with_coverage_status', function () {
        this.requires(['exec:cover_check']);
        return true;
    });
}
