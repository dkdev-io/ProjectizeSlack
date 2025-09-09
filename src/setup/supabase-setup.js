import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SCHEMA_SQL = `
-- User linkages (Slack to Motion account mapping)
CREATE TABLE IF NOT EXISTS user_linkages (
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
CREATE TABLE IF NOT EXISTS channel_mappings (
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
CREATE TABLE IF NOT EXISTS task_queue (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slack_message_ts TEXT NOT NULL,
    slack_channel_id TEXT NOT NULL,
    slack_user_id TEXT NOT NULL,
    extracted_tasks JSONB NOT NULL,
    retry_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    last_attempt TIMESTAMP,
    CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

-- Historical task mappings for learning
CREATE TABLE IF NOT EXISTS task_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slack_message_ts TEXT NOT NULL,
    slack_channel_id TEXT NOT NULL,
    original_message TEXT NOT NULL,
    extracted_tasks JSONB NOT NULL,
    motion_task_ids TEXT[],
    success BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_linkages_slack_user ON user_linkages(slack_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_mappings_channel ON channel_mappings(slack_channel_id, slack_workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_task_history_channel ON task_history(slack_channel_id, created_at);
`;

async function setupDatabase() {
  try {
    console.log('🏗️  Setting up Supabase database schema...');
    
    // Execute schema creation
    const { error } = await supabase.rpc('exec_sql', { sql: SCHEMA_SQL });
    
    if (error) {
      console.error('❌ Database setup failed:', error);
      process.exit(1);
    }
    
    console.log('✅ Database schema created successfully!');
    console.log('📊 Created tables:');
    console.log('  - user_linkages (Slack to Motion account mappings)');
    console.log('  - channel_mappings (Channel to project mappings)');
    console.log('  - task_queue (Failed/retry task queue)');
    console.log('  - task_history (Historical task data for learning)');
    
  } catch (error) {
    console.error('❌ Setup error:', error);
    process.exit(1);
  }
}

// Run setup if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupDatabase();
}

export { setupDatabase };