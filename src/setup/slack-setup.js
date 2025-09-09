import dotenv from 'dotenv';

dotenv.config();

// Slack App Configuration for Manual Setup
export const SLACK_APP_MANIFEST = {
  display_information: {
    name: "Projectize",
    description: "AI-powered task extraction to Motion",
    background_color: "#2c3e50"
  },
  features: {
    bot_user: {
      display_name: "Projectize",
      always_online: true
    },
    app_home: {
      home_tab_enabled: true,
      messages_tab_enabled: false,
      messages_tab_read_only_enabled: false
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
        "app_mentions:read",
        "channels:join"
      ]
    }
  },
  settings: {
    event_subscriptions: {
      bot_events: [
        "app_mention",
        "message.channels",
        "reaction_added",
        "app_home_opened",
        "member_joined_channel"
      ]
    },
    interactivity: {
      is_enabled: true
    },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false
  }
};

export function displaySetupInstructions() {
  console.log(`
🚀 SLACK APP SETUP INSTRUCTIONS

1. Go to https://api.slack.com/apps
2. Click "Create New App" > "From an app manifest"
3. Select your workspace
4. Copy and paste this manifest:

${JSON.stringify(SLACK_APP_MANIFEST, null, 2)}

5. Click "Next" and "Create"

6. CONFIGURE TOKENS:
   - Go to "OAuth & Permissions" 
   - Copy the "Bot User OAuth Token" (starts with xoxb-)
   - Add to .env as SLACK_BOT_TOKEN=xoxb-...

   - Go to "Basic Information" > "App-Level Tokens"
   - Click "Generate Token and Scopes"
   - Name: "Socket Mode Token"
   - Scopes: connections:write
   - Copy token (starts with xapp-)
   - Add to .env as SLACK_APP_TOKEN=xapp-...

   - Copy "Signing Secret" from "Basic Information"
   - Add to .env as SLACK_SIGNING_SECRET=...

7. ENABLE SOCKET MODE:
   - Go to "Socket Mode"
   - Enable "Enable Socket Mode"

8. INSTALL TO WORKSPACE:
   - Go to "Install App"
   - Click "Install to Workspace"
   - Authorize the app

9. INVITE TO CHANNELS:
   - Type "/invite @projectize" in any channel
   - Or mention @projectize to start using

✅ Your Slack app is ready!
`);
}

export function validateSlackSetup() {
  const issues = [];
  
  if (!process.env.SLACK_BOT_TOKEN) {
    issues.push('❌ SLACK_BOT_TOKEN missing from .env');
  } else if (!process.env.SLACK_BOT_TOKEN.startsWith('xoxb-')) {
    issues.push('❌ SLACK_BOT_TOKEN should start with "xoxb-"');
  }
  
  if (!process.env.SLACK_APP_TOKEN) {
    issues.push('❌ SLACK_APP_TOKEN missing from .env');
  } else if (!process.env.SLACK_APP_TOKEN.startsWith('xapp-')) {
    issues.push('❌ SLACK_APP_TOKEN should start with "xapp-"');
  }
  
  if (!process.env.SLACK_SIGNING_SECRET) {
    issues.push('❌ SLACK_SIGNING_SECRET missing from .env');
  }
  
  if (issues.length === 0) {
    console.log('✅ Slack configuration looks good!');
    return true;
  } else {
    console.log('🔧 Slack Setup Issues:');
    issues.forEach(issue => console.log(`  ${issue}`));
    return false;
  }
}

// Run setup if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🔧 Slack App Setup\n');
  
  if (validateSlackSetup()) {
    console.log('Slack is already configured. Run the app with: npm run dev');
  } else {
    displaySetupInstructions();
  }
}