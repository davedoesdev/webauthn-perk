/*eslint-env node */
"use strict";
const path = require('path');

const c8 = "npx c8 -x Gruntfile.cjs -x 'test/**' -x wdio.conf.cjs";

module.exports = function (grunt) {
    grunt.initConfig({
        eslint: {
            target: [
                '*.js',
                '*.cjs',
                'test/**/*.js',
                'test/**/*.cjs',
                'dist/**/*.js',
                '!dist/axios.js',
                '!dist/cred-response-validators.js'
            ]
        },

        exec: Object.fromEntries(Object.entries({ 
            test: `npx wdio run wdio.conf.cjs`,
            cover: `${c8} grunt --gruntfile Gruntfile.cjs test`,
            cover_report: `${c8} report -r lcov`,
            cover_check: `${c8} check-coverage --statements 100 --branches 100 --functions 100 --lines 100`,
            docs: 'asciidoc -b docbook -o - README.adoc | pandoc -f docbook -t gfm -o README.md'
        }).map(([k, cmd]) => [k, { cmd, stdio: 'inherit' }])),

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

            schemas: {
                header: '/* eslint indent: [ error, 2 ] */ export default ',
                footer: ';',
                files: {
                    './dist/schemas.webauthn4js.js': path.join(path.dirname(require.resolve('webauthn4js')), 'schemas', 'schemas.json')
                },
                options: {
                    skipCheck: true
                }
            }
        }
    });

    grunt.loadNpmTasks('grunt-file-wrap');

    if (!process.env.npm_package_postinstall) {
        grunt.loadNpmTasks('grunt-eslint');
        grunt.loadNpmTasks('grunt-exec');
    }

    grunt.registerTask('lint', 'eslint');

    grunt.registerTask('docs', 'exec:docs');

    grunt.registerTask('test', 'exec:test');

    grunt.registerTask('coverage', [
        'exec:cover',
        'exec:cover_report',
        'exec:cover_check'
    ]);

    grunt.registerTask('compile-schemas', async function () {
        const cb = this.async();

        const { writeFile } = require('fs/promises');
        const Ajv = require('ajv');
        const standaloneCode = require('ajv/dist/standalone/index.js');
        const { cred } = await import('./dist/schemas.js');

        const ajv = new Ajv({
            code: {
                source: true, // this option is required to generate standalone code
                esm: true
            }
        });

        function add_schema(method, status) {
            ajv.addSchema(cred[method].response[status], `${method}${status}`);
        }

        add_schema('get', 200);
        add_schema('get', 404);
        add_schema('put', 201);

        await writeFile(
            path.join(__dirname, 'dist', 'cred-response-validators.js'),
            standaloneCode(ajv));

        cb();
    });
};
