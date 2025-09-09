import dotenv from 'dotenv';

dotenv.config();

export const MOTION_SETUP_CONFIG = {
  authentication_method: "API_KEY", // Motion uses API keys, not OAuth for most integrations
  base_url: "https://api.usemotion.com/v1",
  rate_limits: {
    requests_per_minute: 60,
    tasks_per_batch: 10
  },
  setup_instructions: [
    "1. Admin logs into Motion at https://app.usemotion.com",
    "2. Go to Settings > Integrations > API",
    "3. Create new API key for 'Projectize Slack Integration'",
    "4. Copy the API key and add to .env as MOTION_API_KEY=...",
    "5. Note your Workspace ID from the URL or API response"
  ],
  permissions_required: [
    "Create tasks",
    "Read workspaces", 
    "Read projects",
    "Read users"
  ],
  note: "Motion API doesn't support individual user OAuth for most plans. Using workspace-level integration with admin API key."
};

export function displayMotionSetup() {
  console.log(`
🎯 MOTION INTEGRATION SETUP

Motion Integration Method: API Key Authentication

SETUP STEPS:

1. LOGIN TO MOTION:
   → Go to https://app.usemotion.com
   → Sign in with admin account

2. CREATE API KEY:
   → Settings > Integrations > API
   → Click "Create API Key"
   → Name: "Projectize Slack Integration" 
   → Copy the generated key

3. GET WORKSPACE ID:
   → Note your Workspace ID from Motion URL
   → Or make a test API call to /v1/workspaces

4. UPDATE .ENV FILE:
   Add these lines to your .env file:
   
   MOTION_API_KEY=your_api_key_here
   MOTION_WORKSPACE_ID=your_workspace_id_here

5. VERIFY INTEGRATION:
   Run: npm run setup:motion
   
API DETAILS:
- Base URL: ${MOTION_SETUP_CONFIG.base_url}
- Rate Limit: ${MOTION_SETUP_CONFIG.rate_limits.requests_per_minute} requests/minute
- Batch Size: ${MOTION_SETUP_CONFIG.rate_limits.tasks_per_batch} tasks max per batch

REQUIRED PERMISSIONS:
${MOTION_SETUP_CONFIG.permissions_required.map(perm => `   ✓ ${perm}`).join('\n')}

NOTE: ${MOTION_SETUP_CONFIG.note}
`);
}

export async function validateMotionSetup() {
  const issues = [];
  
  if (!process.env.MOTION_API_KEY) {
    issues.push('❌ MOTION_API_KEY missing from .env');
  }
  
  if (!process.env.MOTION_WORKSPACE_ID) {
    issues.push('⚠️  MOTION_WORKSPACE_ID missing - will use default workspace');
  }
  
  if (issues.length === 0) {
    console.log('✅ Motion configuration looks good!');
    
    // Test the API connection
    try {
      const { MotionService } = await import('../services/motion.js');
      const motionService = new MotionService();
      
      console.log('🔄 Testing Motion API connection...');
      const healthCheck = await motionService.healthCheck();
      
      if (healthCheck.healthy) {
        console.log('✅ Motion API connection successful!');
        
        // Show available workspaces
        const workspacesResult = await motionService.getWorkspaces();
        if (workspacesResult.success && workspacesResult.workspaces?.length > 0) {
          console.log('\n📁 Available Workspaces:');
          workspacesResult.workspaces.forEach(ws => {
            console.log(`   • ${ws.name} (ID: ${ws.id})`);
          });
        }
        
        return true;
      } else {
        console.log(`❌ Motion API test failed: ${healthCheck.error}`);
        return false;
      }
      
    } catch (error) {
      console.log(`❌ Motion API test error: ${error.message}`);
      return false;
    }
  } else {
    console.log('🔧 Motion Setup Issues:');
    issues.forEach(issue => console.log(`  ${issue}`));
    return false;
  }
}

export function showMotionIntegrationTips() {
  console.log(`
💡 MOTION INTEGRATION TIPS:

TASK CREATION:
• Tasks sync to the default workspace unless channel is mapped
• Assignees are matched by email address when possible
• Due dates support natural language ("next Tuesday", "Friday")
• Priority mapping: high/medium/low → HIGH/MEDIUM/LOW

CHANNEL MAPPING:
• Use "@projectize setup" in channels to map to Motion projects
• Unmapped channels use default workspace
• Project names are matched by similarity

TROUBLESHOOTING:
• Rate limits: Max ${MOTION_SETUP_CONFIG.rate_limits.requests_per_minute} requests/minute
• Batch limits: Max ${MOTION_SETUP_CONFIG.rate_limits.tasks_per_batch} tasks at once
• Failed tasks are queued for retry automatically
• Check Motion API status at https://status.usemotion.com

WORKSPACE SETUP:
• Ensure team members exist in Motion
• Create projects that match your Slack channels
• Consider Motion's project/workspace structure
`);
}

// Run setup if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🎯 Motion Integration Setup\n');
  
  const isValid = await validateMotionSetup();
  
  if (!isValid) {
    displayMotionSetup();
  } else {
    showMotionIntegrationTips();
  }
}