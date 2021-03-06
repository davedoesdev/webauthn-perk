module.exports = {
    "env": {
        "es6": true
    },
    "extends": "eslint:recommended",
    "parser": "babel-eslint",
    "parserOptions": {
        "ecmaVersion": 2018,
        "sourceType": "module"
    },
    "rules": {
        "indent": [
            "error",
            4
        ],
        "linebreak-style": [
            "error",
            "unix"
        ],
        "semi": [
            "error",
            "always"
        ],
        "brace-style": [
            "error",
            "1tbs"
        ],
        "no-unused-vars": [
            "error", {
                "varsIgnorePattern": "^unused_",
                "argsIgnorePattern": "^unused_"
            }
        ]
    }
};
