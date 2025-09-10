import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export class ClaudeService {
  
  constructor() {
    this.model = 'claude-3-haiku-20240307'; // Fast, cost-effective for task extraction
  }
  
  async extractTasks(messageText, context = {}) {
    const { 
      channelName = 'general',
      authorName = 'unknown',
      readmeRules = 'None specified',
      previousMessages = []
    } = context;
    
    const prompt = `You are an AI assistant that extracts actionable tasks from Slack messages.

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
- Include confidence level: "high", "medium", or "low"
- Add brief context explaining why this is a task

Extract tasks from this message:
${messageText}

Channel context: ${channelName}
Message author: ${authorName}
Previous pinned readme rules: ${readmeRules}

Return JSON array of task objects. If no actionable tasks found, return empty array [].`;

    try {
      const response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 1000,
        temperature: 0.1, // Low temperature for consistent extraction
        messages: [{
          role: 'user',
          content: prompt
        }]
      });
      
      const content = response.content[0].text;
      
      // Parse JSON response
      let tasks;
      try {
        // Try to extract JSON from the response (Claude might add text before/after)
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        const jsonText = jsonMatch ? jsonMatch[0] : content;
        
        const parsed = JSON.parse(jsonText);
        tasks = Array.isArray(parsed) ? parsed : [parsed];
      } catch (parseError) {
        console.warn('Failed to parse Claude response as JSON:', content);
        
        // Try to extract JSON more aggressively
        try {
          const cleanContent = content
            .replace(/^[^[{]*/, '') // Remove text before JSON
            .replace(/[^}\]]*$/, ''); // Remove text after JSON
          
          const parsed = JSON.parse(cleanContent);
          tasks = Array.isArray(parsed) ? parsed : [parsed];
        } catch (secondParseError) {
          return {
            success: false,
            error: 'Failed to parse AI response',
            tasks: [],
            raw_response: content
          };
        }
      }
      
      // Validate and clean tasks
      const validTasks = tasks
        .filter(task => task && typeof task === 'object')
        .map(task => this.validateTask(task))
        .filter(task => task !== null);
      
      return {
        success: true,
        tasks: validTasks,
        total_found: validTasks.length,
        model_used: this.model
      };
      
    } catch (error) {
      console.error('Claude API error:', error);
      return {
        success: false,
        error: error.message,
        tasks: []
      };
    }
  }
  
  validateTask(task) {
    // Required fields
    if (!task.title || typeof task.title !== 'string') {
      return null;
    }
    
    // Clean and validate task
    const cleanTask = {
      title: task.title.trim(),
      assignee: task.assignee || 'infer_from_context',
      due_date: task.due_date || null,
      confidence: task.confidence || 'medium',
      context: task.context || '',
      priority: task.priority || 'medium',
      estimated_time: task.estimated_time || null
    };
    
    // Validate confidence level
    if (!['high', 'medium', 'low'].includes(cleanTask.confidence)) {
      cleanTask.confidence = 'medium';
    }
    
    // Validate priority level  
    if (!['high', 'medium', 'low'].includes(cleanTask.priority)) {
      cleanTask.priority = 'medium';
    }
    
    return cleanTask;
  }
  
  async improveTaskFromFeedback(originalTask, feedback, context = {}) {
    const prompt = `You are helping improve a task extraction based on user feedback.

ORIGINAL TASK:
${JSON.stringify(originalTask, null, 2)}

USER FEEDBACK:
"${feedback}"

CONTEXT:
Channel: ${context.channelName || 'general'}
Author: ${context.authorName || 'unknown'}

Please return an improved version of the task based on the feedback. 
Maintain the same JSON structure but update fields as needed.
If the feedback indicates the task should be removed, return null.`;

    try {
      const response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 500,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });
      
      const content = response.content[0].text;
      
      try {
        const improvedTask = JSON.parse(content);
        return improvedTask ? this.validateTask(improvedTask) : null;
      } catch (parseError) {
        console.warn('Failed to parse improved task:', content);
        return originalTask; // Return original if parsing fails
      }
      
    } catch (error) {
      console.error('Claude feedback processing error:', error);
      return originalTask; // Return original on error
    }
  }
  
  async suggestProjectMapping(channelName, channelTopic = '', recentMessages = []) {
    const prompt = `Based on a Slack channel, suggest Motion workspace and project mapping.

CHANNEL INFO:
Name: ${channelName}
Topic: ${channelTopic}
Recent activity: ${recentMessages.slice(0, 3).join('. ')}

Suggest appropriate Motion workspace and project names that would make sense for this channel.
Consider common project patterns like:
- Marketing campaigns
- Product development  
- Operations
- Sales projects
- Engineering sprints

Return JSON with suggested mapping:
{
  "workspace": "suggested workspace name",
  "project": "suggested project name", 
  "confidence": "high/medium/low",
  "reasoning": "why this mapping makes sense"
}`;

    try {
      const response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 300,
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });
      
      const content = response.content[0].text;
      
      try {
        return JSON.parse(content);
      } catch (parseError) {
        return {
          workspace: 'General',
          project: channelName.replace('#', '').replace('-', ' '),
          confidence: 'low',
          reasoning: 'Default mapping based on channel name'
        };
      }
      
    } catch (error) {
      console.error('Project mapping suggestion error:', error);
      return {
        workspace: 'General',
        project: channelName.replace('#', '').replace('-', ' '),
        confidence: 'low',
        reasoning: 'Error occurred, using default mapping'
      };
    }
  }
  
  // Health check
  async healthCheck() {
    try {
      const response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: 'Say "OK" if you are working.'
        }]
      });
      
      return {
        healthy: true,
        model: this.model,
        response: response.content[0].text,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      return {
        healthy: false,
        model: this.model,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export default new ClaudeService();