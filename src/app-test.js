import pkg from '@slack/bolt';
const { App } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Simple test handlers
app.event('app_mention', async ({ event, client, logger }) => {
  try {
    await client.chat.postMessage({
      channel: event.channel,
      text: `🚀 Projectize is working! You mentioned: "${event.text}"`
    });
  } catch (error) {
    logger.error('Error handling mention:', error);
  }
});

app.event('app_home_opened', async ({ event, client, logger }) => {
  try {
    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🚀 *Welcome to Projectize!*\n\nBasic Slack connection is working!\n\nNext steps:\n• Configure Claude API key\n• Set up Supabase database\n• Configure Motion integration'
            }
          }
        ]
      }
    });
  } catch (error) {
    logger.error('Error publishing home view:', error);
  }
});

app.error(async (error) => {
  console.error('Slack app error:', error);
});

// Start the app
(async () => {
  try {
    const port = process.env.PORT || 3000;
    await app.start(port);
    
    console.log('⚡️ Projectize test app is running!');
    console.log('🏠 Socket Mode enabled - no public endpoint needed');
    console.log('✅ Slack connection working');
    console.log('\n📋 Next steps:');
    console.log('1. Install app to workspace');
    console.log('2. Invite @projectize to a channel');
    console.log('3. Test with @projectize hello');
  } catch (error) {
    console.error('Failed to start app:', error);
    process.exit(1);
  }
})();