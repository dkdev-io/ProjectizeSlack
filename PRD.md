# Product Requirements Document: Projectize Slack Agent (Claude Code Implementation)

## Overview
Build a Slack agent that intelligently extracts actionable tasks from conversations and syncs them to Motion via OAuth2. The agent uses AI for smart inference, provides preview/edit functionality, and maintains persistent memory of user preferences and task mappings.

## Technical Stack
- **Runtime**: Node.js 18+
- **Framework**: @slack/bolt-js (Socket Mode)
- **Database**: Supabase (PostgreSQL)
- **AI**: Anthropic Claude API
- **Authentication**: OAuth2 (Slack + Motion)
- **Deployment**: Slack Socket Mode (no public endpoint required)

## Project Structure
```
projectize-slack-agent/
├── src/
│   ├── app.js                 # Main Slack Bolt app
│   ├── handlers/
│   │   ├── mention.js         # Handle @projectize mentions
│   │   ├── quote.js           # Handle blockquote/reply extraction
│   │   └── batch.js           # Batch task processing
│   ├── services/
│   │   ├── claude.js          # AI task extraction service
│   │   ├── motion.js          # Motion API integration
│   │   └── supabase.js        # Database operations
│   ├── utils/
│   │   ├── parser.js          # Message parsing utilities
│   │   └── validator.js       # Task validation logic
│   └── setup/
│       ├── slack-setup.js     # Slack app configuration script
│       ├── motion-setup.js    # Motion OAuth setup script
│       └── supabase-setup.js  # Database schema creation
├── package.json
├── .env.example
└── README.md
```

## Database Schema (Supabase)

### Tables to Create:
```sql
-- User linkages (Slack to Motion account mapping)
CREATE TABLE user_linkages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slack_user_id TEXT NOT NULL UNIQUE,
    slack_workspace_id TEXT NOT NULL,
    motion_access_token TEXT NOT NULL,
    motion_refresh_token TEXT,
    motion_user_id TEXT,
    linked_at TIMESTAMP DEFAULT NOW(),
    last_used TIMESTAMP DEFAULT NOW()
);

-- Channel project mappings 
CREATE TABLE channel_mappings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slack_channel_id TEXT NOT NULL,
    slack_workspace_id TEXT NOT NULL,
    motion_workspace_id TEXT NOT NULL,
    motion_project_id TEXT,
    project_name TEXT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(slack_channel_id, slack_workspace_id)
);

-- Task queue for failed/retry tasks
CREATE TABLE task_queue (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slack_message_ts TEXT NOT NULL,
    slack_channel_id TEXT NOT NULL,
    slack_user_id TEXT NOT NULL,
    extracted_tasks JSONB NOT NULL,
    retry_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    last_attempt TIMESTAMP
);

-- Historical task mappings for learning
CREATE TABLE task_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slack_message_ts TEXT NOT NULL,
    slack_channel_id TEXT NOT NULL,
    original_message TEXT NOT NULL,
    extracted_tasks JSONB NOT NULL,
    motion_task_ids TEXT[],
    success BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Setup Scripts Required

### 1. Slack App Setup Script (`src/setup/slack-setup.js`)
```javascript
// Create Slack app with these exact settings:
const SLACK_APP_CONFIG = {
  manifest: {
    display_information: {
      name: "Projectize",
      description: "AI-powered task extraction to Motion",
      background_color: "#2c3e50"
    },
    features: {
      bot_user: {
        display_name: "Projectize",
        always_online: true
      }
    },
    oauth_config: {
      scopes: {
        bot: [
          "channels:read",
          "channels:history", 
          "chat:write",
          "reactions:write",
          "users:read",
          "app_mentions:read"
        ]
      }
    },
    settings: {
      event_subscriptions: {
        bot_events: [
          "app_mention",
          "message.channels"
        ]
      },
      socket_mode_enabled: true
    }
  }
};
```

### 2. Motion OAuth Setup Script (`src/setup/motion-setup.js`)
```javascript
// Motion API Key Setup - Motion doesn't support OAuth2 for individual users
// Instead, use a service account approach with admin API key
const MOTION_SETUP_CONFIG = {
  authentication_method: "API_KEY", // X-API-Key header
  setup_instructions: [
    "1. Admin logs into Motion",
    "2. Go to Settings > API Keys", 
    "3. Create API key for Projectize integration",
    "4. Store key securely in environment variables",
    "5. All tasks will be created under this admin account"
  ],
  note: "Motion API doesn't support individual user OAuth - consider workspace-level integration"
};
```

## AI Task Extraction Logic

### Claude API Prompting Strategy
```javascript
const TASK_EXTRACTION_PROMPT = `
You are an AI assistant that extracts actionable tasks from Slack messages. 

EXAMPLES:
Input: "Jenny, I think the website needs to be done next Tuesday for us to launch."
Output: {
  "title": "Complete website for launch",
  "assignee": "Jenny", 
  "due_date": "next Tuesday",
  "confidence": "high",
  "context": "needed for launch"
}

Input: "We're going to need the logo before Thursday so we can send to the printer."
Output: {
  "title": "Deliver logo for printing", 
  "assignee": "infer_from_context",
  "due_date": "before Thursday",
  "confidence": "medium",
  "context": "for printer deadline"
}

Input: "The printer will be finished Friday - I will plan to pick it up."
Output: {
  "title": "Pick up from printer",
  "assignee": "message_author",
  "due_date": "Friday", 
  "confidence": "high",
  "context": "printer completion"
}

RULES:
- Only extract clear, actionable tasks
- For ambiguous assignees, use "infer_from_context" or "message_author"  
- Skip tentative language ("maybe", "might", "could")
- Skip past due items
- Skip questions without clear ownership
- Return empty array if no actionable tasks found

Extract tasks from this message:
{message_text}

Channel context: {channel_name}
Message author: {author_name}
Previous pinned readme rules: {readme_rules}

Return JSON array of task objects.
`;
```

## Core User Flows

### 1. Initial Channel Setup Flow
1. User invites @projectize to channel
2. Bot posts: "Hi! I'm Projectize 🚀 I'll help extract tasks from conversations and sync them to Motion. Let me set up this channel..."
3. Bot analyzes channel name and suggests Motion workspace/project mapping
4. Bot posts interactive message: "I think this channel maps to **[Workspace Name] > [Project Name]** in Motion. ✅ Confirm or ✉️ Edit?"
5. User reacts to confirm or replies with corrections
6. Bot updates channel mapping and pins setup confirmation

### 2. Task Extraction Flow
1. User mentions @projectize or quotes text with `>` 
2. Bot processes with Claude API for task extraction
3. Bot posts preview message:
   ```
   📋 Found 2 tasks from your message:
   
   1. ✅ **Complete website for launch** 
      👤 Jenny | 📅 next Tuesday | 📁 Website Project
      
   2. ✅ **Pick up from printer**
      👤 You | 📅 Friday | 📁 Marketing Project
      
   React with ✅ to create these tasks, or reply to edit.
   ```
4. User can:
   - React ✅ to approve all
   - Reply "Remove task 2" or "Change task 1 assignee to Mark"
   - React ❌ to cancel

### 3. Motion Account Linking Flow
1. When user first tries to create tasks, bot detects no Motion link
2. Bot posts: "🔗 Link your Motion account to create tasks: [Link Motion Account]"
3. OAuth flow redirects user through Motion authorization
4. On success, bot posts: "✅ Motion account linked! Your tasks are now being created..."

### 4. Error Handling & Retry Flow
1. If Motion API fails, bot immediately posts: "⚠️ Couldn't sync to Motion right now. Tasks saved for retry."
2. Task goes to `task_queue` table with status 'pending'
3. Background process retries failed tasks every 5 minutes
4. After 3 failed attempts, bot notifies user: "❌ Task sync failed multiple times. Please check your Motion connection."
5. User can react 🔄 to manually retry

## Environment Variables Required
```bash
# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret

# Motion
MOTION_CLIENT_ID=your-motion-client-id
MOTION_CLIENT_SECRET=your-motion-client-secret
MOTION_REDIRECT_URI=https://your-domain.com/auth/motion/callback

# Claude
ANTHROPIC_API_KEY=your-claude-api-key

# Supabase
SUPABASE_URL=your-project-url
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
```

## Key Implementation Requirements

### Message Event Handling
- Listen for `app_mention` events for @projectize mentions
- Listen for `message` events in channels where bot is member
- Parse quoted text (lines starting with `>`) as task extraction requests
- Ignore bot's own messages and messages older than 5 minutes

### AI Integration Points
- Use Claude API for task extraction with structured JSON response
- Implement confidence scoring for extraction quality
- Handle ambiguous cases by asking for user clarification
- Learn from user corrections to improve future extractions

### Motion API Integration
- Implement full OAuth2 flow with refresh token handling
- Use Motion's `/v1/tasks` endpoint for task creation
- Handle rate limiting (10 tasks per batch, queue excess)
- Map Slack users to Motion assignees via email or user ID

### Data Persistence Strategy
- Store all user linkages securely in Supabase
- Cache channel mappings for fast lookup
- Queue failed tasks for automatic retry
- Log all successful task creations for learning

### Error Scenarios to Handle
1. Motion API rate limit exceeded → Queue tasks for later
2. User Motion token expired → Prompt re-authentication  
3. Invalid project/workspace mapping → Ask user to reconfigure
4. Ambiguous task extraction → Request clarification
5. Network timeouts → Retry with exponential backoff
6. Slack API failures → Log error and notify admin channel

## Success Metrics
- Task extraction accuracy (user approval rate >85%)
- Motion sync success rate (>95%)
- Average time from message to task creation (<30 seconds)
- User engagement (daily active users extracting tasks)

## Security & Compliance
- Never store Motion passwords, only OAuth tokens
- Encrypt all tokens in Supabase
- Implement token rotation and refresh logic
- Audit log all task operations
- Respect Slack channel permissions (only process invited channels)
- GDPR compliance for EU users (data deletion on request)

This PRD provides Claude Code with exact technical specifications, clear data models, specific error handling requirements, and complete user flows needed to build the Projectize Slack agent without ambiguity.