#!/usr/bin/env node

import { CLI } from './CLI.mjs'


const cli = new CLI()

cli.start()
    .then( ( { exitCode } ) => process.exit( exitCode ) )
    .catch( ( error ) => {
        // Handle inquirer abort (Ctrl+C during prompt)
        if( error.name === 'ExitPromptError' ) {
            process.exit( 0 )
        }

        console.error( 'Fatal Error:', error.message )
        process.exit( 99 )
    } )
