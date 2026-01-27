import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { UserConfig } from '../../../src/utils/UserConfig.mjs'
import {
    TEST_CONFIG,
    createTestDir,
    cleanupTestDir,
    createValidConfig,
    createValidSetConfig,
    createInvalidSetConfig,
    createCorruptedJson,
    createTemplate
} from '../../helpers/config.mjs'


describe( 'UserConfig', () => {
    let testDir

    beforeEach( async () => {
        testDir = path.join( os.tmpdir(), 'ralph-test-' + Date.now() + '-' + Math.random().toString( 36 ).slice( 2 ) )
        await createTestDir( { testDir } )
    } )

    afterEach( async () => {
        await cleanupTestDir( { testDir } )
    } )


    describe( 'loadConfig', () => {
        it( 'loads valid config successfully', async () => {
            await createValidConfig( { testDir } )

            const { config } = await UserConfig.loadConfig( { configPath: testDir } )

            expect( config ).toEqual( TEST_CONFIG.validConfigContent )
        } )


        it( 'throws error when config.json does not exist', async () => {
            await expect(
                UserConfig.loadConfig( { configPath: testDir } )
            ).rejects.toThrow( 'Config not found or invalid' )
        } )


        it( 'error message contains expected path', async () => {
            try {
                await UserConfig.loadConfig( { configPath: testDir } )
                fail( 'Should have thrown' )
            } catch ( err ) {
                expect( err.message ).toContain( testDir )
                expect( err.message ).toContain( 'config.json' )
            }
        } )


        it( 'error message contains init hint', async () => {
            try {
                await UserConfig.loadConfig( { configPath: testDir } )
                fail( 'Should have thrown' )
            } catch ( err ) {
                expect( err.message ).toContain( 'Copy examples/.ralph/' )
            }
        } )


        it( 'throws error on corrupted JSON', async () => {
            await createCorruptedJson( { testDir, filename: 'config.json' } )

            await expect(
                UserConfig.loadConfig( { configPath: testDir } )
            ).rejects.toThrow( 'Config not found or invalid' )
        } )
    } )


    describe( 'loadSetConfig', () => {
        it( 'loads valid set config successfully', async () => {
            await createValidSetConfig( { testDir, setName: 'test-set' } )

            const { setConfig } = await UserConfig.loadSetConfig( {
                configPath: testDir,
                setName: 'test-set'
            } )

            expect( setConfig.name ).toBe( 'test-set' )
            expect( setConfig.conversion ).toBeDefined()
            expect( setConfig.task ).toBeDefined()
        } )


        it( 'throws error when set.json does not exist', async () => {
            await expect(
                UserConfig.loadSetConfig( {
                    configPath: testDir,
                    setName: 'nonexistent-set'
                } )
            ).rejects.toThrow( 'Set config not found or invalid' )
        } )


        it( 'error message contains set path', async () => {
            try {
                await UserConfig.loadSetConfig( {
                    configPath: testDir,
                    setName: 'missing-set'
                } )
                fail( 'Should have thrown' )
            } catch ( err ) {
                expect( err.message ).toContain( 'missing-set' )
                expect( err.message ).toContain( 'set.json' )
            }
        } )


        it( 'throws error on validation failure', async () => {
            await createInvalidSetConfig( { testDir, setName: 'invalid-set' } )

            await expect(
                UserConfig.loadSetConfig( {
                    configPath: testDir,
                    setName: 'invalid-set'
                } )
            ).rejects.toThrow( 'Set config validation failed' )
        } )


        it( 'validation error contains all missing fields', async () => {
            await createInvalidSetConfig( { testDir, setName: 'invalid-set' } )

            try {
                await UserConfig.loadSetConfig( {
                    configPath: testDir,
                    setName: 'invalid-set'
                } )
                fail( 'Should have thrown' )
            } catch ( err ) {
                expect( err.message ).toContain( 'version' )
                expect( err.message ).toContain( 'conversion' )
                expect( err.message ).toContain( 'task' )
            }
        } )


        it( 'validation error contains expected structure', async () => {
            await createInvalidSetConfig( { testDir, setName: 'invalid-set' } )

            try {
                await UserConfig.loadSetConfig( {
                    configPath: testDir,
                    setName: 'invalid-set'
                } )
                fail( 'Should have thrown' )
            } catch ( err ) {
                expect( err.message ).toContain( 'Expected structure' )
            }
        } )
    } )


    describe( 'listSets', () => {
        it( 'lists sets from valid directory', async () => {
            await createValidSetConfig( { testDir, setName: 'set-a' } )
            await createValidSetConfig( { testDir, setName: 'set-b' } )

            const { sets } = await UserConfig.listSets( { configPath: testDir } )

            expect( sets ).toContain( 'set-a' )
            expect( sets ).toContain( 'set-b' )
            expect( sets.length ).toBe( 2 )
        } )


        it( 'throws error when sets directory does not exist', async () => {
            await expect(
                UserConfig.listSets( { configPath: testDir } )
            ).rejects.toThrow( 'Sets directory not found' )
        } )


        it( 'error message contains sets path', async () => {
            try {
                await UserConfig.listSets( { configPath: testDir } )
                fail( 'Should have thrown' )
            } catch ( err ) {
                expect( err.message ).toContain( testDir )
                expect( err.message ).toContain( 'sets' )
            }
        } )


        it( 'error message contains init hint', async () => {
            try {
                await UserConfig.listSets( { configPath: testDir } )
                fail( 'Should have thrown' )
            } catch ( err ) {
                expect( err.message ).toContain( 'Copy examples/.ralph/' )
            }
        } )
    } )


    describe( 'ensureDir', () => {
        it( 'returns existing directory without error', async () => {
            const { created, ralphDir } = await UserConfig.ensureDir( { configPath: testDir } )

            expect( created ).toBe( false )
            expect( ralphDir ).toBe( testDir )
        } )


        it( 'throws error when directory does not exist', async () => {
            const nonexistentDir = path.join( testDir, 'nonexistent', 'deep', 'path' )

            await expect(
                UserConfig.ensureDir( { configPath: nonexistentDir } )
            ).rejects.toThrow( 'Ralph config directory not found' )
        } )


        it( 'error message contains the missing path', async () => {
            const nonexistentDir = path.join( testDir, 'missing-dir' )

            try {
                await UserConfig.ensureDir( { configPath: nonexistentDir } )
                fail( 'Should have thrown' )
            } catch ( err ) {
                expect( err.message ).toContain( 'missing-dir' )
            }
        } )


        it( 'error message contains init hint', async () => {
            const nonexistentDir = path.join( testDir, 'missing-dir' )

            try {
                await UserConfig.ensureDir( { configPath: nonexistentDir } )
                fail( 'Should have thrown' )
            } catch ( err ) {
                expect( err.message ).toContain( 'Copy examples/.ralph/' )
            }
        } )
    } )


    describe( 'templateExists', () => {
        it( 'returns true for existing template', async () => {
            await createTemplate( { testDir, setName: 'test-set', templateName: 'executor' } )

            const { exists } = await UserConfig.templateExists( {
                configPath: testDir,
                setName: 'test-set',
                templateName: 'executor'
            } )

            expect( exists ).toBe( true )
        } )


        it( 'returns false for non-existent template (ENOENT)', async () => {
            const setsDir = path.join( testDir, 'sets', 'test-set' )
            await fs.mkdir( setsDir, { recursive: true } )

            const { exists } = await UserConfig.templateExists( {
                configPath: testDir,
                setName: 'test-set',
                templateName: 'nonexistent'
            } )

            expect( exists ).toBe( false )
        } )


        it( 'returns false when set directory does not exist', async () => {
            const { exists } = await UserConfig.templateExists( {
                configPath: testDir,
                setName: 'nonexistent-set',
                templateName: 'executor'
            } )

            expect( exists ).toBe( false )
        } )
    } )


    describe( 'getRalphDir', () => {
        it( 'returns path in home directory', () => {
            const { ralphDir } = UserConfig.getRalphDir()

            expect( ralphDir ).toContain( os.homedir() )
            expect( ralphDir ).toContain( '.ralph' )
        } )
    } )


    describe( 'getTemplatePath', () => {
        it( 'returns correct template path', () => {
            const { templatePath } = UserConfig.getTemplatePath( {
                configPath: testDir,
                setName: 'my-set',
                templateName: 'executor'
            } )

            expect( templatePath ).toContain( testDir )
            expect( templatePath ).toContain( 'my-set' )
            expect( templatePath ).toContain( 'executor.prompt.md' )
        } )
    } )


    describe( 'validateSetConfig', () => {
        it( 'validates correct config', () => {
            const { valid, messages } = UserConfig.validateSetConfig( {
                setConfig: TEST_CONFIG.validSetContent
            } )

            expect( valid ).toBe( true )
            expect( messages.length ).toBe( 0 )
        } )


        it( 'fails on missing required keys', () => {
            const { valid, messages } = UserConfig.validateSetConfig( {
                setConfig: { name: 'test' }
            } )

            expect( valid ).toBe( false )
            expect( messages.some( ( m ) => m.includes( 'version' ) ) ).toBe( true )
            expect( messages.some( ( m ) => m.includes( 'conversion' ) ) ).toBe( true )
            expect( messages.some( ( m ) => m.includes( 'task' ) ) ).toBe( true )
        } )


        it( 'fails when conversion is not an array', () => {
            const { valid, messages } = UserConfig.validateSetConfig( {
                setConfig: {
                    name: 'test',
                    version: '1.0.0',
                    conversion: 'not-an-array',
                    task: []
                }
            } )

            expect( valid ).toBe( false )
            expect( messages.some( ( m ) => m.includes( 'Must be an array' ) ) ).toBe( true )
        } )


        it( 'fails when conversion array is empty', () => {
            const { valid, messages } = UserConfig.validateSetConfig( {
                setConfig: {
                    name: 'test',
                    version: '1.0.0',
                    conversion: [],
                    task: [ { tool: 'claude' } ]
                }
            } )

            expect( valid ).toBe( false )
            expect( messages.some( ( m ) => m.includes( 'at least one tool config' ) ) ).toBe( true )
        } )
    } )


    describe( 'getToolConfig', () => {
        it( 'returns first config when no toolName specified', () => {
            const setConfig = {
                conversion: [ { tool: 'claude', options: {} } ],
                task: [ { tool: 'claude', options: {} } ]
            }

            const { config } = UserConfig.getToolConfig( {
                setConfig,
                phase: 'conversion'
            } )

            expect( config ).toEqual( { tool: 'claude', options: {} } )
        } )


        it( 'returns config by tool name', () => {
            const setConfig = {
                conversion: [
                    { tool: 'other', options: { a: 1 } },
                    { tool: 'claude', options: { b: 2 } }
                ],
                task: []
            }

            const { config } = UserConfig.getToolConfig( {
                setConfig,
                phase: 'conversion',
                toolName: 'claude'
            } )

            expect( config.options.b ).toBe( 2 )
        } )


        it( 'returns null when tool not found', () => {
            const setConfig = {
                conversion: [ { tool: 'claude' } ],
                task: []
            }

            const { config } = UserConfig.getToolConfig( {
                setConfig,
                phase: 'conversion',
                toolName: 'nonexistent'
            } )

            expect( config ).toBeNull()
        } )
    } )
} )
