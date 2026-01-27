# Execute PRD Generation Task

You are executing a task that generates Product Requirements Documents (PRDs) for the Ralph autonomous agent system.

## Context
- PRD ID: {{PRD_ID}}
- Project: {{PROJECT_NAME}}
- Branch: {{BRANCH_NAME}} (use this branch in ALL affected repos)
- Working Directory: You are already in {{WORKING_DIR}}

## Available Repositories:
{{TARGET_DIRS}}

## Previously Completed Tasks:
{{COMPLETED_TASKS}}

## Current Task to Execute:

{{CURRENT_TASK}}

## Affected Repositories for this task:
{{AFFECTED_REPOS}}

## Code Context (if provided):
{{CODE_CONTEXT}}

## Constraints (if provided):
{{CONSTRAINTS}}

---

## PRD Generation Guidelines (CRITICAL)

### Information Preservation
- Preserve ALL technical details from source materials
- Copy relevant context, constraints, and requirements VERBATIM
- Never summarize or abbreviate critical technical details
- Include ALL edge cases and error handling requirements

### PRD ID Format
- Use format: `PRD-{CATEGORY}-{NNN}`
- Category: 3-5 letter abbreviation (e.g., AUTH, CATALOG, CART, PAY)
- Number: 3 digits, sequential (001, 002, ...)

### Required PRD Structure
Each generated PRD MUST include these sections:

1. **Title & ID** - `# PRD-XXX-NNN: Descriptive Title`
2. **Background** - Why this feature is needed, context
3. **Objectives** - Specific, measurable goals
4. **Scope**
   - In Scope: What IS included
   - Out of Scope: What is NOT included
5. **Requirements**
   - Functional Requirements (numbered: FR-1, FR-2, ...)
   - Non-Functional Requirements (NFR-1, NFR-2, ...)
6. **Technical Constraints** - Technology stack, limitations
7. **Dependencies** - Other PRDs, external systems
8. **Acceptance Criteria** - Verifiable success criteria
9. **Risks & Mitigations** - Known risks and how to handle them

### Quality Checklist (Verify Before Completing)
- [ ] All technical details from source are preserved
- [ ] Scope boundaries are clearly defined
- [ ] Requirements are specific and testable
- [ ] Dependencies are explicitly stated
- [ ] Acceptance criteria are measurable
- [ ] No ambiguous language ("should", "might", "could")

---

## Instructions:

### 1. Branch Management (IMPORTANT: Do this for EACH affected repo)
For each repository in affected repos:
- Navigate to the repo directory
- Check if branch "{{BRANCH_NAME}}" exists
- If not, create it from main: `git checkout -b {{BRANCH_NAME}}`
- If exists, checkout: `git checkout {{BRANCH_NAME}}`

### 2. PRD Generation
- Generate the PRD following the guidelines above
- Write the PRD file to `.ralph-prds/` folder in the working directory
- Create the folder if it doesn't exist: `mkdir -p .ralph-prds`
- Filename format: `{PRD-ID}.prd.md` (e.g., `PRD-AUTH-001.prd.md`)
- Use `.prd.md` extension

### 3. Verification
- Verify the PRD file was created
- Verify all required sections are present
- Verify no information was lost

### 4. Commits (CRITICAL: One commit per affected repo)
- Only commit if PRD is complete and valid
- Use the SAME commit message in ALL repos:
  `[Ralph] {{PRD_ID}} {{TASK_ID}}: Generate PRD for {feature}`
- Commit EACH affected repo separately
- Record ALL commit hashes in the response

### 5. Failure Handling
- If PRD cannot be generated completely, mark it as "blocked" or "failed"
- Provide clear notes explaining what went wrong
- Do NOT commit partial or incomplete PRDs

---

## Output Format

Return the updated task as JSON with these fields updated:

```json
{
    "id": "US-XXX",
    "title": "...",
    "description": "...",
    "status": "completed|failed|blocked",
    "priority": "...",
    "dependencies": [...],
    "affectedRepos": ["repo-1", "repo-2"],
    "acceptanceCriteria": [
        {
            "criterion": "PRD file created",
            "type": "automatable",
            "status": "passed|failed|blocked",
            "notes": "Created PRD-XXX-NNN.prd.md"
        },
        {
            "criterion": "All required sections present",
            "type": "automatable",
            "status": "passed|failed|blocked",
            "notes": "Verified 9/9 sections"
        }
    ],
    "passes": true|false,
    "securityCheck": {
        "passed": true|false,
        "issues": []
    },
    "commits": [
        {
            "repo": "repo-1",
            "repoPath": "./repo-1",
            "branch": "ralph/feature-name",
            "commitHash": "abc1234"
        }
    ],
    "changedFiles": [
        {
            "repo": "working-dir",
            "path": ".ralph-prds/PRD-XXX-NNN.prd.md",
            "action": "created"
        }
    ],
    "generatedPrds": [
        {
            "prdId": "PRD-XXX-NNN",
            "filename": "PRD-XXX-NNN.prd.md",
            "path": ".ralph-prds/PRD-XXX-NNN.prd.md"
        }
    ],
    "criticalNotes": [],
    "notes": "Summary of what was done or why it failed"
}
```

### Status Rules:
- `passes: true` only if ALL `automatable` criteria have `status: "passed"` AND `securityCheck.passed: true`
- `status: "completed"` only if `passes: true`
- `status: "blocked"` if user input/decision is needed for automatable criteria
- `status: "failed"` if PRD generation is not possible OR security check failed
- `commits` array should contain one entry per repo that was modified
- `generatedPrds` array should list all PRDs that were created

Return ONLY the JSON, no markdown code blocks, no explanation.
