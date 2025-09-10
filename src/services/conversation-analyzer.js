export class ConversationAnalyzerService {
  
  constructor(claudeService) {
    this.claudeService = claudeService;
  }
  
  async analyzeConversationHistory(client, channel, currentMessageTs, botUserId) {
    try {
      console.log(`📚 Analyzing conversation history in channel ${channel}`);
      
      // Get the last time the bot was mentioned
      const lastBotMention = await this.findLastBotMention(client, channel, currentMessageTs, botUserId);
      
      // Get all messages since the last bot mention (or last 50 messages if no prior mention)
      const messages = await this.getMessagesSince(client, channel, lastBotMention, currentMessageTs);
      
      if (messages.length === 0) {
        console.log(`📭 No conversation history to analyze`);
        return {
          success: true,
          tasks: [],
          messagesAnalyzed: 0,
          timeRange: 'none'
        };
      }
      
      console.log(`📊 Found ${messages.length} messages to analyze since ${lastBotMention ? 'last mention' : 'channel start'}`);
      
      // Combine messages into conversation context
      const conversationText = this.buildConversationContext(messages);
      
      // Extract tasks from the entire conversation
      const extractionResult = await this.claudeService.extractTasks(conversationText, {
        channelName: 'conversation-history',
        authorName: 'multiple-users',
        analysisType: 'conversation_history',
        messageCount: messages.length
      });
      
      return {
        success: extractionResult.success,
        tasks: extractionResult.tasks || [],
        messagesAnalyzed: messages.length,
        timeRange: this.getTimeRange(messages),
        conversationContext: conversationText.substring(0, 500) + '...', // Preview
        error: extractionResult.error
      };
      
    } catch (error) {
      console.error('Conversation analysis error:', error);
      return {
        success: false,
        error: error.message,
        tasks: [],
        messagesAnalyzed: 0
      };
    }
  }
  
  async findLastBotMention(client, channel, beforeTs, botUserId) {
    try {
      // Look back through channel history to find last bot mention
      const history = await client.conversations.history({
        channel: channel,
        oldest: Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000), // 7 days ago
        latest: beforeTs,
        limit: 200
      });
      
      if (!history.messages) {
        return null;
      }
      
      // Find the most recent message that mentions the bot (excluding current message)
      for (const message of history.messages) {
        if (message.ts !== beforeTs && message.text && message.text.includes(`<@${botUserId}>`)) {
          console.log(`🔍 Found last bot mention at ${message.ts}`);
          return message.ts;
        }
      }
      
      console.log(`🔍 No previous bot mentions found, analyzing recent history`);
      return null;
      
    } catch (error) {
      console.error('Error finding last bot mention:', error);
      return null;
    }
  }
  
  async getMessagesSince(client, channel, sinceTs, beforeTs) {
    try {
      // If no prior mention, get more history (48 hours or 200 messages)
      const oldest = sinceTs || Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000); // 48 hours ago if no prior mention
      
      const history = await client.conversations.history({
        channel: channel,
        oldest: oldest,
        latest: beforeTs,
        limit: 200 // Increased from 100
      });
      
      if (!history.messages) {
        return [];
      }
      
      // Filter out bot messages and system messages
      const relevantMessages = history.messages
        .filter(msg => 
          msg.type === 'message' && 
          !msg.subtype && 
          msg.text && 
          msg.text.trim().length > 5 &&
          !msg.text.includes('has joined the channel') &&
          !msg.text.includes('has left the channel')
        )
        .reverse(); // Chronological order
      
      return relevantMessages;
      
    } catch (error) {
      console.error('Error getting message history:', error);
      return [];
    }
  }
  
  buildConversationContext(messages) {
    let context = 'RECENT CONVERSATION HISTORY:\n\n';
    
    messages.forEach((message, index) => {
      const timestamp = new Date(parseFloat(message.ts) * 1000).toLocaleString();
      const user = message.user_profile?.real_name || message.user_profile?.display_name || 'User';
      const text = this.cleanMessageText(message.text);
      
      context += `[${timestamp}] ${user}: ${text}\n`;
    });
    
    context += '\nPLEASE EXTRACT ALL ACTIONABLE TASKS from this conversation history. Look for:\n';
    context += '- Commitments people made\n';
    context += '- Deadlines mentioned\n';
    context += '- Work assignments\n';
    context += '- Follow-up actions\n';
    context += '- Things people said they would do\n\n';
    
    return context;
  }
  
  cleanMessageText(text) {
    if (!text) return '';
    
    return text
      .replace(/<@[A-Z0-9]+>/g, '@user') // Replace user mentions
      .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1') // Replace channel mentions
      .replace(/<([^|>]+)\|([^>]+)>/g, '$2') // Replace links
      .replace(/\n/g, ' ') // Single line
      .trim();
  }
  
  getTimeRange(messages) {
    if (messages.length === 0) return 'none';
    
    const firstTs = parseFloat(messages[0].ts);
    const lastTs = parseFloat(messages[messages.length - 1].ts);
    const duration = lastTs - firstTs;
    
    if (duration < 3600) { // Less than 1 hour
      return `${Math.round(duration / 60)} minutes`;
    } else if (duration < 86400) { // Less than 1 day
      return `${Math.round(duration / 3600)} hours`;
    } else {
      return `${Math.round(duration / 86400)} days`;
    }
  }
  
  async getConversationSummary(messages, extractedTasks) {
    const totalMessages = messages.length;
    const totalTasks = extractedTasks.length;
    const timeRange = this.getTimeRange(messages);
    
    const participants = [...new Set(messages.map(m => 
      m.user_profile?.real_name || m.user_profile?.display_name || 'Unknown'
    ))];
    
    return {
      summary: `Analyzed ${totalMessages} messages over ${timeRange}`,
      participants: participants.length,
      participantList: participants.slice(0, 5), // Show first 5
      tasksFound: totalTasks,
      timeRange: timeRange
    };
  }
}

export default ConversationAnalyzerService;