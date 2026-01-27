# Convert PRD to JSON

You are converting a Product Requirements Document (PRD) into a structured JSON format for the Ralph autonomous agent system.

## Input PRD:

{{PRD_CONTENT}}

## Project Info:
- Project Name: {{PROJECT_NAME}}
- Working Directory: {{WORKING_DIR}}
- PRD Filename: {{PRD_FILENAME}}

### PRD ID Extraction
- Extract PRD ID from filename: If filename matches `PRD-XXX-NNN.*` pattern, use that as `prdId`
- Example: `PRD-ONB-001.prd.md` -> `prdId: "PRD-ONB-001"`
- Fallback: Use {{PROJECT_NAME}} as prdId

## Available Repositories:
{{TARGET_DIRS}}

## Output Requirements:

### Branch Naming
- Generate branch name: `ralph/{kebab-case-from-title}`
- Example: "User Status Feature" -> `ralph/user-status-feature`
- This branch name will be used ACROSS ALL affected repositories

### Target Directories (IMPORTANT)
- `workingDir`: The parent directory where Claude executes ({{WORKING_DIR}})
- `targetDirs`: Array of repositories that MAY be modified
- Each user story should specify which repos it affects via `affectedRepos`
- Do NOT create new git repos - only use existing ones listed above

### User Stories
- Split into atomic user stories (US-001, US-002, ...)
- Each story must be completable in ONE Claude Code session
- Stories should be small and focused
- Set dependencies based on logical order
- Specify `affectedRepos` for each story (which repos will be modified)

### Acceptance Criteria
- Each story needs clear, verifiable acceptance criteria
- **IMPORTANT**: Mark each criterion with a `type`:
  - `"automatable"` - Can be verified automatically (typecheck, lint, tests, file exists)
  - `"manual"` - Requires human verification (browser check, visual inspection, QA)
- Include "Typecheck passes" (automatable) in EVERY task (if applicable)
- Include "Verify in browser" (manual) for UI-related tasks
- Each criterion needs: criterion, type, status ("pending"), notes (null)

### Initial State
- All story statuses: "pending"
- All passes: false
- All commits: [] (empty array)

### Multi-Repo Commits
- Each story can affect multiple repositories
- Each affected repo gets its own commit with the SAME commit message
- Commit message format: `[Ralph] {prdId} {US-ID}: Brief description`
- Example: `[Ralph] PRD-ONB-001 US-001: Add status column`

### Code Context (IMPORTANT for multi-repo)
- Include `repo` field to specify which repository the file is in
- Example: `{ "repo": "rails-app", "path": "app/models/user.rb", "purpose": "Add status field" }`

## Output Format

Return ONLY valid JSON matching this structure:

```json
{
    "id": "feature-name",
    "prdId": "PRD-ONB-001",
    "title": "Feature Title from PRD",
    "description": "Brief description",
    "branchName": "ralph/feature-name",
    "workingDir": "{{WORKING_DIR}}",
    "targetDirs": [
        {
            "path": "./repo-name",
            "name": "repo-name",
            "description": "What this repo does"
        }
    ],
    "createdAt": "ISO timestamp",
    "userStories": [
        {
            "id": "US-001",
            "title": "First Story Title",
            "description": "What this story accomplishes",
            "status": "pending",
            "priority": "high|medium|low",
            "dependencies": [],
            "affectedRepos": ["repo-name"],
            "acceptanceCriteria": [
                {
                    "criterion": "Typecheck passes",
                    "type": "automatable",
                    "status": "pending",
                    "notes": null
                },
                {
                    "criterion": "Verify button appears in browser",
                    "type": "manual",
                    "status": "pending",
                    "notes": null
                }
            ],
            "codeContext": [
                {
                    "repo": "repo-name",
                    "path": "src/file.js",
                    "purpose": "Why this file is relevant"
                }
            ],
            "constraints": [],
            "patternExample": null,
            "passes": false,
            "commits": [],
            "notes": null
        }
    ]
}
```

Return ONLY the JSON, no markdown code blocks, no explanation.
