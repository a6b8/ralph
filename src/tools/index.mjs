/**
 * Tools Registry
 *
 * Central registry for all tool implementations.
 * Each tool module must implement: validate(), buildArgs(), getToolName()
 */

import { ClaudeTool } from './ClaudeTool.mjs'


class ToolRegistry {
    static #tools = {
        'claude': ClaudeTool
    }


    static getToolNames() {
        const toolNames = Object.keys( this.#tools )

        return { toolNames }
    }


    static getTool( { toolName } ) {
        const tool = this.#tools[ toolName ] || null

        return { tool }
    }


    static hasTool( { toolName } ) {
        const exists = this.#tools[ toolName ] !== undefined

        return { exists }
    }


    static validateToolConfig( { config } ) {
        const { tool: toolName } = config

        if( !toolName ) {
            return { valid: false, messages: [ 'config.tool: Missing required field' ] }
        }

        const { exists } = this.hasTool( { toolName } )

        if( !exists ) {
            const { toolNames } = this.getToolNames()

            return { valid: false, messages: [ `config.tool: Unknown tool "${toolName}". Available: ${toolNames.join( ', ' )}` ] }
        }

        // Delegate to tool-specific validation
        const { tool } = this.getTool( { toolName } )
        const { valid, messages } = tool.validate( { config } )

        return { valid, messages }
    }
}


export { ToolRegistry, ClaudeTool }
