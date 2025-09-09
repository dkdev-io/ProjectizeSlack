export function parseMessage(text) {
  if (!text || typeof text !== 'string') {
    return { content: '', command: null };
  }
  
  // Remove bot mention from the beginning
  const cleanText = text.replace(/^<@[A-Z0-9]+>\s*/i, '').trim();
  
  // Check for commands
  const commandMatch = cleanText.match(/^(help|setup|status)\s*$/i);
  if (commandMatch) {
    return {
      content: '',
      command: commandMatch[1].toLowerCase()
    };
  }
  
  return {
    content: cleanText,
    command: null
  };
}

export function extractQuotedText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  const lines = text.split('\n');
  const quotedLines = lines
    .filter(line => line.trim().startsWith('>'))
    .map(line => line.replace(/^>\s*/, '').trim())
    .filter(line => line.length > 0);
    
  return quotedLines.join(' ');
}

export function parseSlackUserMention(text) {
  if (!text) return null;
  
  const mentionMatch = text.match(/<@([A-Z0-9]+)>/);
  return mentionMatch ? mentionMatch[1] : null;
}

export function parseSlackChannelMention(text) {
  if (!text) return null;
  
  const channelMatch = text.match(/<#([A-Z0-9]+)\|([^>]+)>/);
  return channelMatch ? {
    id: channelMatch[1],
    name: channelMatch[2]
  } : null;
}

export function stripSlackFormatting(text) {
  if (!text) return '';
  
  return text
    .replace(/<@[A-Z0-9]+>/g, '@user') // Replace user mentions
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1') // Replace channel mentions
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2') // Replace links
    .replace(/<([^>]+)>/g, '$1') // Replace simple links
    .replace(/\*([^*]+)\*/g, '$1') // Remove bold
    .replace(/_([^_]+)_/g, '$1') // Remove italics
    .replace(/~([^~]+)~/g, '$1') // Remove strikethrough
    .replace(/`([^`]+)`/g, '$1') // Remove code formatting
    .trim();
}

export function extractEmailFromSlackUser(userProfile) {
  if (!userProfile) return null;
  
  return userProfile.email || userProfile.profile?.email || null;
}

export function formatDueDateForDisplay(dueDateString) {
  if (!dueDateString) return '';
  
  try {
    const date = new Date(dueDateString);
    const now = new Date();
    const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`;
    if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;
    
    return date.toLocaleDateString();
  } catch (error) {
    return dueDateString;
  }
}

export function parseTaskEditCommand(text) {
  if (!text) return null;
  
  // Handle commands like:
  // "Remove task 2"
  // "Change task 1 assignee to Mark" 
  // "Update task 3 due date to Friday"
  
  const removeMatch = text.match(/remove\s+task\s+(\d+)/i);
  if (removeMatch) {
    return {
      action: 'remove',
      taskIndex: parseInt(removeMatch[1]) - 1 // Convert to 0-based index
    };
  }
  
  const changeAssigneeMatch = text.match(/change\s+task\s+(\d+)\s+assignee\s+to\s+(.+)/i);
  if (changeAssigneeMatch) {
    return {
      action: 'change_assignee',
      taskIndex: parseInt(changeAssigneeMatch[1]) - 1,
      newAssignee: changeAssigneeMatch[2].trim()
    };
  }
  
  const changeDateMatch = text.match(/(?:change|update)\s+task\s+(\d+)\s+(?:due\s+)?date\s+to\s+(.+)/i);
  if (changeDateMatch) {
    return {
      action: 'change_date',
      taskIndex: parseInt(changeDateMatch[1]) - 1,
      newDate: changeDateMatch[2].trim()
    };
  }
  
  return null;
}

export function buildSlackBlocks(sections) {
  const blocks = [];
  
  for (const section of sections) {
    switch (section.type) {
      case 'text':
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: section.content
          }
        });
        break;
        
      case 'divider':
        blocks.push({ type: 'divider' });
        break;
        
      case 'buttons':
        blocks.push({
          type: 'actions',
          elements: section.buttons.map(btn => ({
            type: 'button',
            text: { type: 'plain_text', text: btn.text },
            style: btn.style || undefined,
            action_id: btn.actionId,
            value: btn.value || undefined
          }))
        });
        break;
        
      default:
        console.warn('Unknown block section type:', section.type);
    }
  }
  
  return blocks;
}

export function truncateText(text, maxLength = 100) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

export function sanitizeForSlack(text) {
  if (!text) return '';
  
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}