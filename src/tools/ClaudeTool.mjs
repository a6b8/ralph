/**
 * ClaudeTool - Claude Code integration module
 *
 * Handles validation and execution of Claude Code CLI commands.
 * Other tools (gpt4, gemini, etc.) should follow this pattern.
 */


class ClaudeTool {
    static #toolName = 'claude'

    static #allowedOutputFormats = [ 'stream-json', 'json', 'text' ]

    static #optionsSchema = {
        'dangerouslySkipPermissions': { type: 'boolean', required: false, default: true },
        'verbose': { type: 'boolean', required: false, default: true },
        'outputFormat': { type: 'string', required: false, default: 'stream-json', allowed: [ 'stream-json', 'json', 'text' ] }
    }


    static getToolName() {
        return { toolName: this.#toolName }
    }


    static validate( { config } ) {
        const messages = []
        const { tool, options } = config

        // Verify tool name matches
        if( tool !== this.#toolName ) {
            messages.push( `ClaudeTool.validate: Expected tool "claude", got "${tool}"` )

            return { valid: false, messages }
        }

        // Options is optional, use defaults if not provided
        if( options === undefined ) {
            return { valid: true, messages: [] }
        }

        // Options must be an object
        if( typeof options !== 'object' || options === null || Array.isArray( options ) ) {
            messages.push( `config.options: Must be an object` )

            return { valid: false, messages }
        }

        // Validate each option against schema
        Object
            .entries( options )
            .forEach( ( [ key, value ] ) => {
                const schema = this.#optionsSchema[ key ]

                if( !schema ) {
                    messages.push( `config.options.${key}: Unknown option` )

                    return
                }

                // Type check
                if( typeof value !== schema.type ) {
                    messages.push( `config.options.${key}: Must be type "${schema.type}", got "${typeof value}"` )

                    return
                }

                // Allowed values check
                if( schema.allowed && !schema.allowed.includes( value ) ) {
                    messages.push( `config.options.${key}: Invalid value "${value}". Allowed: ${schema.allowed.join( ', ' )}` )
                }
            } )

        const valid = messages.length === 0

        return { valid, messages }
    }


    static validateSkipContext( { config } ) {
        const messages = []
        const { skipContext } = config

        // skipContext is optional
        if( skipContext === undefined ) {
            return { valid: true, messages: [] }
        }

        if( typeof skipContext !== 'boolean' ) {
            messages.push( `config.skipContext: Must be type "boolean", got "${typeof skipContext}"` )
        }

        const valid = messages.length === 0

        return { valid, messages }
    }


    static buildArgs( { config, tableMode = null, systemPromptFile = null } ) {
        const options = config.options || {}
        const args = [ '--print' ]

        // Add dangerously-skip-permissions if configured (default: true)
        if( options.dangerouslySkipPermissions !== false ) {
            args.push( '--dangerously-skip-permissions' )
        }

        // Add verbose if configured or tableMode is set
        if( options.verbose || tableMode ) {
            args.push( '--verbose' )
        }

        // Add output format if configured or tableMode is set
        if( options.outputFormat || tableMode ) {
            args.push( '--output-format', options.outputFormat || 'stream-json' )
        }

        // Add JSON schema if defined
        if( config.outputSchema ) {
            args.push( '--json-schema', JSON.stringify( config.outputSchema ) )
        }

        // Add system prompt file if provided
        if( systemPromptFile ) {
            args.push( '--append-system-prompt-file', systemPromptFile )
        }

        return { args }
    }


    static validateOutputSchema( { schema } ) {
        const messages = []

        if( !schema ) {
            return { valid: true, messages: [] }
        }

        // Schema must be an object
        if( typeof schema !== 'object' || schema === null ) {
            messages.push( 'outputSchema: Must be an object' )

            return { valid: false, messages }
        }

        // Schema should have type: object for root
        if( schema.type && schema.type !== 'object' ) {
            messages.push( 'outputSchema.type: Root type should be "object"' )
        }

        // Required must be array if present
        if( schema.required && !Array.isArray( schema.required ) ) {
            messages.push( 'outputSchema.required: Must be an array' )
        }

        // Properties must be object if present
        if( schema.properties && typeof schema.properties !== 'object' ) {
            messages.push( 'outputSchema.properties: Must be an object' )
        }

        const valid = messages.length === 0

        return { valid, messages }
    }


    static getDefaults() {
        const defaults = {}

        Object
            .entries( this.#optionsSchema )
            .forEach( ( [ key, schema ] ) => {
                defaults[ key ] = schema.default
            } )

        return { defaults }
    }
}


export { ClaudeTool }
