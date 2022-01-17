[Fastify](https://www.fastify.io/) plugin for supporting the [Web
Authentication](https://www.w3.org/TR/webauthn/) Perk pattern (thanks to
[Emil Lundberg](https://github.com/emlun) for
[rephrasing](https://github.com/w3c/webauthn/issues/902#issuecomment-388223929)
my original description):

1.  Alice (an admin) chooses an unguessable ID.

2.  Alice configures `webauthn-perk` on her Web server with the ID.

3.  Alice uses her Web browser to visit a URL on her Web server which
    contains the ID.

4.  Alice uses the Web Authentication API to sign a challenge generated
    on her server.

5.  The signature and Alice’s public key are sent to her server.

6.  Alice’s server verfies the signature.

7.  Alice’s server associates her public key with the ID.

8.  Alice uses client-side script to generate an unsigned JWT containing
    claims of her choosing.

9.  Alice uses the Web Authentication API to generate a signed
    assertion, with the unsigned JWT as the challenge.

10. Alice sends the assertion to ordinary user Bob (by some means).

11. Bob uses his Web browser to visit a well-known URL on Alice’s Web
    server.

12. Bob presents the assertion to Alice’s server.

13. Alice’s server verifies the assertion using Alice’s public key.

14. Bob receives a perk, i.e. Alice’s Web server provides some service
    to Bob.

**Note:** From version 6.0.0, `webauthn-perk` uses
[WebAuthn4JS](https://github.com/davedoesdev/webauthn4js) instead of
[fido2-lib](https://github.com/webauthn-open-source/fido2-lib) and the
API has changed accordingly.

# Example

1.  Run [test/example.js](test/example.js) on your server (`node
    test/example.js`).

2.  Visit the URL it displays in your WebAuthn-supporting browser.
    
      - Either click through the certificate warnings or add
        [test/keys/ca.crt](test/keys/ca.crt) to your browser’s trusted
        certificate authorities.
    
      - The source to this page is in
        [test/fixtures/example.html](test/fixtures/example.html) and
        [test/fixtures/example.js](test/fixtures/example.js). They make
        use of a utility class in
        [dist/perk-workflow.js](dist/perk-workflow.js) which calls the
        Web Authentication API and communicates with the server. You can
        re-use this in your projects —  there’s documentation
        [below](#perk-workflow).

3.  Use your security token to register or authenticate.

4.  Type in a message and click **Generate**.

5.  Use your security token to sign the message.

6.  You’ll be shown another link. Open this in a different browser
    (doesn’t have to support WebAuthn).

7.  You should see your message.

8.  Repeat with different messages as you like.

# Registering

Register `webauthn-perk` with Fastify as normal. The available options
and their defaults are described below.

``` javascript
import webauthn_perk from 'webauthn-perk';
fastify.register(webauthn_perk, {
    webauthn_perk_options: {
        authorize_jwt_options: {
            // The following are supported by AuthorizeJWT
            // See https://github.com/davedoesdev/authorize-jwt#moduleexportsconfig-cb
            db_dir: 'node_modules/pub-keystore/pouchdb/store/pub-keys', // You should override this
            db_type: 'pouchdb',
            db_for_update: true,
            no_changes: true,
            no_updates: true,
            WEBAUTHN_MODE: true,
            async on_authz(unused_authz) {
                // Receives the AuthorizeJWT instance once it's constructed
            },

            // The following are required by WebAuthn4JS. They have no default and you must supply them.
            // See https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.config.html
            RPDisplayName: undefined,
            RPID: undefined,
            RPOrigin: undefined
        },
        cred_options: {
            valid_ids: [], // List of unguessable IDs (strings)
            prefix: '/cred', // Unguessable ID paths are prefixed with this plus /
            session_data_timeout: 60000, // Server challenges expire after this (ms). Note the session data is returned in the JSON responses, NOT in cookies.
            store_prefix: false, // Whether to store complete path from root when associating unguessable IDs with public keys
            default_user: {
                // You can override these but they'll only be used if your authenticator supports storing user handles.
                // See https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.user.html
                id: 'anonymous',
                name: 'Anonymous',
                displayName: 'Anonymous'
            },
            users: {}, // If you want to customise user details per unguessable ID
            registration_options: [
                // See https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.webauthn4js-1.html#beginregistration
            ],
            login_options: [
                // See https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.webauthn4js-1.html#beginlogin
            ]
        },
        perk_options: {
            prefix: '/perk', // Well-known path for presenting assertions is this plus /
            handler: function (info, request, reply) {
                // This function is called after an assertion is successfully verified.
                // You must override this or perk requests will fail.
                // request and reply are standard Fastify objects and your function
                // is treated as a standard route handler.
                // info contains payload, uri, rev and credential properties
                // as described for the cb parameter here:
                // https://github.com/davedoesdev/authorize-jwt#authorizejwtprototypeauthorizeauthz_token-algorithms-cb
                // The uri property is the unguessable ID associated with the public
                // key that generated the assertion.
                throw new Error('missing handler');
            },
            response_schema: undefined, // JSON schema for handler responses
            payload_schema: undefined // JSON schema for the payload in the unsigned JWT contained in that are presented
        }
    }
});
```

# Routes

The following routes will be added to your server. All request and
response bodies should be JSON-encoded.

  - `/cred/*id*/` for each `*id*` in
    `webauthn_perk_options.cred_options.valid_ids`
    
      - GET requests:
        
          - If no public key is associated with `*id*` then the response
            status is 404 and the body will contain a
            [`CredentialCreation`](https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.credentialcreation.html)
            and an encrypted
            [`SessionData`](https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.sessiondata.html)
            returned by
            [`beginRegistration`](https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.webauthn4js-1.html#beginregistration).
            The `CredentialCreation` can be used when calling
            `navigator.credentials.create` in a browser. The
            `SessionData` must be used in a subsequent PUT request (see
            below).
        
          - If a public key has been associated with `*id*` then the
            response status is 200 and the body will contain an issuer
            ID (identifes the public key to the server), a
            [`CredentialAssertion`](https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.credentialassertion.html)
            and an encrypted
            [`SessionData`](https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.sessiondata.html)
            returned by
            [`beginLogin`](https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.webauthn4js-1.html#beginlogin).
            The `CredentialAssertion` can be used when calling
            `navigator.credentials.get` in a browser. The `SessionData`
            must be used in a subsequent POST request (see below).
    
      - PUT requests:
        
          - The request body should contain a
            [`CredentialCreationResponse`](https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.credentialcreationresponse.html)
            generated by `navigator.credentials.create` in a browser.
            You should have made a GET request previously to obtain the
            options required by `navigator.credentials.create`.
        
          - If the creation response does not verify or is invalid then
            the response status is 400.
        
          - If a public key is already associated with `*id*` then the
            response status is 409.
        
          - Otherwise the public key contained in the creation response
            is associated with `*id*` and the response status is 200.
            The response body will contain the issuer ID (identifies the
            public key to the server) and a
            [`CredentialAssertion`](https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.credentialassertion.html)
            (identifies the public key to the browser).
    
      - POST requests:
        
          - The request body should contain a
            [`CredentialAssertionResponse`](https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.credentialassertionresponse.html)
            generated by `navigator.credentials.get` in a browser. You
            should have made a GET request previously to obtain the
            options required by `navigator.credentials.get`.
        
          - If no public key is associated with `*id*` then the response
            status is 404.
        
          - If the assertion response does not verify using the public
            key associated with `*id*` or is invalid then the response
            status is 400.
        
          - Otherwise the response status is 204 and the body is empty.
        
          - Use this route to check you have access to the private key
            which corresponds to the public key that the server has
            associated with `*id*`.

  - `/perk/`
    
      - POST requests:
        
          - The request body should contain an issuer ID (obtained from
            a previous GET or PUT request to `/cred/*id*/`) and a
            [`CredentialAssertionResponse`](https://rawgit.davedoesdev.com/davedoesdev/webauthn4js/master/docs/interfaces/webauthn4js.credentialassertionresponse.html)
            generated by `navigator.credentials.get` in a browser.
        
          - The challenge used to generate the assertion response should
            be an *unsigned* JWT. The request body is passed to
            [authorize-jwt](https://github.com/davedoesdev/authorize-jwt#authorizejwtprototypeauthorizeauthz_token-algorithms-cb)
            for verification.
        
          - If the issuer ID does not identify a public key or the
            assertion response does not verify using the public key
            identified by the issuer ID then the response status is 400.
        
          - Otherwise `webauthn_perk_options.perk_options.handler` is
            called.
    
      - GET requests:
        
          - The request should have a single parameter, `assertion`,
            containing the same JSON-encoded data required by POST
            requests to `/perk/` (issuer ID and assertion response).
        
          - The `assertion` is passed to the POST route handler for
            `/perk/`.
        
          - The response is the same as described above for POST
            requests for `/perk/`.

JSON schemas for these routes can be found in
[dist/schemas.js](dist/schemas.js).

# Browser Utility Class

## Description

[dist/perk-workflow.js](dist/perk-workflow.js) contains a class,
`PerkWorkflow`, which you can use from your browser-side Javascript to
call the Web Authentication API and communicate with your server.

The script is an ES2015 module so you should include it using `<script
type="module">`. It exports the `PerkWorkflow` class.

If you construct a `PerkWorkflow` object with no arguments, it tries to
guess your server’s routes from the URL of the page. If your page is at:

<div class="informalexample">

<https://example.com/a/b/c/unguessableid>

</div>

or

<div class="informalexample">

<https://example.com/a/b/c/unguessableid/>

</div>

then `PerkWorkflow` will use the following URLs for making credential
and perk requests:

<div class="informalexample">

<https://example.com/a/b/c/cred/unguessableid/>  
<https://example.com/a/b/c/perk/>

</div>

You can override this behaviour by passing an object containing
`cred_path` and/or `perk_path` properties to \`\`PerkWorkflow\`\`'s
constructor.

You can also supply options for `navigator.credentials.create` and
`navigator.credentials.get` by passing `attestation_options` and
`assertion_options` properties respectively.

## authenticate()

Once you’ve made a `workflow = new PerkWorkflow()`, call its
`authenticate()` method to register the user’s security token against
`unguessableid` on your server:

``` javascript
await workflow.authenticate();
```

If a token has already been registered against `unguessableid`, then
`authenticate()` will verify the registered token is the same as the
user’s.

Once `await workflow.authenticate()` returns, registration or
verification of the user’s security token against `unguessableid` is
complete. If an error occurs, `authenticate()` will throw an exception.

## perk(jwt)

Once `workflow.authenticate()` has registered or verified the user’s
security token, you can call `workflow.perk(jwt)` to generate a perk URL
containing a signed assertion.

1.  Make an *unsigned* serialized JWT using your favourite JWT library.

2.  Call `url = await workflow.perk(jwt)`, passing the unsigned JWT as
    the argument.

3.  Arrange for the returned `url` to be sent to the user(s) you wish to
    receive the perk.

Please see [test/fixtures/example.js](test/fixtures/example.js) for an
example of how to use `PerkWorkflow`.

## Overrides

As `authenticate()` proceeds, the following methods will be called. You
can customise each stage of the authentication process by
\`\`extend\`\`ing the `PerkWorkflow` class and overriding one or more of
the methods.

  - async before\_register()
    
      - Called when no security token has been registered against the
        credential ID (`unguessableid` here).
    
      - Called before the browser’s Web Authentication API is invoked to
        sign the registration challenge received from the server.
        
        You might display a prompt to ask the user to register their
        token, for example.

  - async after\_register()
    
      - Called after the Web Authentication API has generated a
        signature using the user’s security token.
    
      - Called after the signature is sent to the server in order to
        register the token against the credential ID.
        
        You might remove any registration prompt displayed, for example.

  - async before\_verify()
    
      - Called when a security token has already been registered against
        the credential ID.
    
      - Called before the browser’s Web Authentication API is invoked to
        sign the verification challenge received from the server.
        
        You might display a prompt to ask the user to verify their
        token, for example.

  - async after\_verify()
    
      - Called after the Web Authentication API has generated a
        signature using the user’s security token.
    
      - Called after the signature is sent to the server in order to
        verify the user’s token is the same as the one registered
        against the credential ID.
        
        You might remove any verification prompt displayed, for example.

  - async verify()
    
      - Called when a security token has already been registered against
        the credential ID.
    
      - The implementation in `PerkWorkflow` calls the Web
        Authentication API to sign a verification challenge received
        from the server and then sends the signature back to the server.
        
        To disable verification you should override like this:
        
        ``` javascript
        async verify() {
            this.unpack_result();
        }
        ```
        
        Although you won’t know whether the user’s token is the same as
        the one registered against the credential ID, if it isn’t then
        your server will not successfully verify URLs returned by
        [perk(jwt)](#perk).

  - async before\_perk()
    
      - Called by [perk(jwt)](#perk) before it generates a perk URL
        containing a signed assertion.

  - async after\_perk()
    
      - Called by [perk(jwt)](#perk) after it generates a perk URL
        containing a signed assertion.

# Installation

``` bash
npm install webauthn-perk
```

# Licence

[MIT](LICENCE)

# Test

``` bash
grunt --gruntfile Gruntfile.cjs test
```

# Lint

``` bash
grunt --gruntfile Gruntfile.cjs lint
```

# Coverage

``` bash
grunt --gruntfile Gruntfile.cjs coverage
```

[c8](https://github.com/bcoe/c8) results are available
[here](https://gitlab.com/davedoesdev/webauthn-perk/builds/artifacts/master/download?job=ci).
