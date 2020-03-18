/*eslint-env node */

import path from 'path';
import load_grunt_tasks from 'load-grunt-tasks';

const mod_path = path.join('.', 'node_modules');
const bin_path = path.join(mod_path, '.bin');
const babel_path = path.join(bin_path, 'babel');
const nyc_path = path.join(bin_path, 'nyc');
const wdio_path = path.join(bin_path, 'wdio');
const grunt_path = path.join(bin_path, 'grunt');

const coverage_path = path.join(__dirname, '.nyc_output');
const instrument_path = 'test/node_modules/webauthn-perk';

export default function (grunt) {
    grunt.initConfig({
        eslint: {
            target: [
                '*.js',
                'test/**/*.js',
                '!test/node_modules/**/*.js',
                'dist/**/*.js',
                '!dist/axios.js',
                '!dist/ajv.bundle.js'
            ]
        },

        exec: {
            test: `node -r esm ${wdio_path}`,
            wdio_cleanup: './test/wdio_cleanup.sh',

            instrument: {
                cmd: [
                    `${babel_path} common.js cred.js index.js perk.js plugin.js --out-dir ${instrument_path}`,
                    `mkdir -p ${instrument_path}/dist`,
                    `cp dist/schemas.js ${instrument_path}/dist`,
                ].join('&&'),
                options: {
                    env: Object.assign({}, process.env, {
                        NODE_ENV: 'test'
                    })
                }
            },

            cover: {
                cmd: [
                    `mkdir -p '${coverage_path}'`,
                    `${grunt_path} test`
                ].join('&&'),
                options: {
                    env: Object.assign({}, process.env, {
                        NYC_OUTPUT_DIR: coverage_path
                    })
                }
            },
            cover_report: `${nyc_path} report -r lcov -r text`,
            cover_check: `${nyc_path} check-coverage --statements 100 --branches 100 --functions 100 --lines 100`
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
        'exec:instrument',
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
