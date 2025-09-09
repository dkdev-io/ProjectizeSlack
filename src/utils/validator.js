export function validateTask(task) {
  const errors = [];
  
  // Required fields
  if (!task.title || typeof task.title !== 'string') {
    errors.push('Task title is required');
  } else if (task.title.trim().length < 3) {
    errors.push('Task title must be at least 3 characters');
  }
  
  // Optional field validations
  if (task.assignee && typeof task.assignee !== 'string') {
    errors.push('Assignee must be a string');
  }
  
  if (task.confidence && !['high', 'medium', 'low'].includes(task.confidence)) {
    errors.push('Confidence must be high, medium, or low');
  }
  
  if (task.priority && !['high', 'medium', 'low'].includes(task.priority)) {
    errors.push('Priority must be high, medium, or low');
  }
  
  if (task.due_date && task.due_date.length > 100) {
    errors.push('Due date string is too long');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

export function validateTaskBatch(tasks) {
  if (!Array.isArray(tasks)) {
    return {
      valid: false,
      errors: ['Tasks must be an array']
    };
  }
  
  if (tasks.length === 0) {
    return {
      valid: false,
      errors: ['At least one task is required']
    };
  }
  
  if (tasks.length > 10) {
    return {
      valid: false,
      errors: ['Maximum 10 tasks allowed per batch']
    };
  }
  
  const allErrors = [];
  tasks.forEach((task, index) => {
    const validation = validateTask(task);
    if (!validation.valid) {
      allErrors.push(`Task ${index + 1}: ${validation.errors.join(', ')}`);
    }
  });
  
  return {
    valid: allErrors.length === 0,
    errors: allErrors
  };
}

export function validateEnvironment() {
  const requiredVars = [
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN', 
    'SLACK_SIGNING_SECRET',
    'ANTHROPIC_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY'
  ];
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  const warnings = [];
  if (!process.env.MOTION_API_KEY) {
    warnings.push('MOTION_API_KEY not set - Motion integration will not work');
  }
  if (!process.env.MOTION_WORKSPACE_ID) {
    warnings.push('MOTION_WORKSPACE_ID not set - using default workspace');
  }
  
  return {
    valid: missing.length === 0,
    missing: missing,
    warnings: warnings
  };
}

export function validateSlackEvent(event) {
  if (!event) {
    return { valid: false, error: 'Event is required' };
  }
  
  if (!event.type) {
    return { valid: false, error: 'Event type is required' };
  }
  
  // Validate specific event types
  switch (event.type) {
    case 'app_mention':
      if (!event.text || !event.user || !event.channel) {
        return { valid: false, error: 'app_mention missing required fields' };
      }
      break;
      
    case 'message':
      if (!event.text || !event.user || !event.channel) {
        return { valid: false, error: 'message event missing required fields' };
      }
      break;
      
    case 'reaction_added':
      if (!event.reaction || !event.user || !event.item) {
        return { valid: false, error: 'reaction_added missing required fields' };
      }
      break;
  }
  
  return { valid: true };
}

export function validateChannelMapping(mapping) {
  const errors = [];
  
  if (!mapping.slack_channel_id) {
    errors.push('Slack channel ID is required');
  }
  
  if (!mapping.slack_workspace_id) {
    errors.push('Slack workspace ID is required');
  }
  
  if (!mapping.motion_workspace_id) {
    errors.push('Motion workspace ID is required');
  }
  
  if (!mapping.created_by) {
    errors.push('Creator user ID is required');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

export function validateUserLinkage(linkage) {
  const errors = [];
  
  if (!linkage.slack_user_id) {
    errors.push('Slack user ID is required');
  }
  
  if (!linkage.slack_workspace_id) {
    errors.push('Slack workspace ID is required');
  }
  
  if (!linkage.motion_access_token) {
    errors.push('Motion access token is required');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

export function sanitizeInput(input, maxLength = 1000) {
  if (typeof input !== 'string') {
    return '';
  }
  
  return input
    .trim()
    .substring(0, maxLength)
    .replace(/[<>]/g, ''); // Remove potential XSS characters
}

export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidSlackUserId(userId) {
  if (!userId || typeof userId !== 'string') return false;
  
  // Slack user IDs are typically 9-11 characters starting with U
  return /^U[A-Z0-9]{8,10}$/.test(userId);
}

export function isValidSlackChannelId(channelId) {
  if (!channelId || typeof channelId !== 'string') return false;
  
  // Slack channel IDs are typically 9-11 characters starting with C
  return /^C[A-Z0-9]{8,10}$/.test(channelId);
}

export function rateLimitCheck(userId, action, windowMs = 60000, maxRequests = 10) {
  // Simple in-memory rate limiting
  if (!rateLimitCheck.cache) {
    rateLimitCheck.cache = new Map();
  }
  
  const key = `${userId}:${action}`;
  const now = Date.now();
  
  if (!rateLimitCheck.cache.has(key)) {
    rateLimitCheck.cache.set(key, []);
  }
  
  const requests = rateLimitCheck.cache.get(key);
  
  // Remove old requests outside the window
  const validRequests = requests.filter(timestamp => now - timestamp < windowMs);
  
  if (validRequests.length >= maxRequests) {
    return {
      allowed: false,
      retryAfter: Math.ceil((validRequests[0] + windowMs - now) / 1000)
    };
  }
  
  // Add current request
  validRequests.push(now);
  rateLimitCheck.cache.set(key, validRequests);
  
  return {
    allowed: true,
    remaining: maxRequests - validRequests.length
  };
}