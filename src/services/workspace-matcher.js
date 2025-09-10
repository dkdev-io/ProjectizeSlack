export class WorkspaceMatcherService {
  
  constructor(motionService) {
    this.motionService = motionService;
  }
  
  async suggestWorkspaceAndProject(extractedTasks, allWorkspaces) {
    const suggestions = [];
    
    for (const task of extractedTasks) {
      const suggestion = await this.findBestMatch(task, allWorkspaces);
      suggestions.push({
        task: task,
        workspace: suggestion.workspace,
        project: suggestion.project,
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning
      });
    }
    
    return suggestions;
  }
  
  async findBestMatch(task, workspaces) {
    const taskText = `${task.title} ${task.context || ''}`.toLowerCase();
    
    // Keywords to workspace mapping
    const workspaceMatches = workspaces.map(workspace => {
      const score = this.calculateWorkspaceScore(taskText, workspace);
      return {
        workspace,
        score,
        reasoning: score.reasoning
      };
    }).sort((a, b) => b.score.total - a.score.total);
    
    const bestMatch = workspaceMatches[0];
    
    // Get projects for the best workspace
    let suggestedProject = null;
    try {
      const projectsResult = await this.motionService.getProjects(bestMatch.workspace.id);
      if (projectsResult.success && projectsResult.projects?.length > 0) {
        suggestedProject = this.findBestProject(taskText, projectsResult.projects);
      }
    } catch (error) {
      console.warn('Could not get projects for workspace:', error);
    }
    
    return {
      workspace: bestMatch.workspace,
      project: suggestedProject,
      confidence: bestMatch.score.total > 3 ? 'high' : bestMatch.score.total > 1 ? 'medium' : 'low',
      reasoning: bestMatch.reasoning
    };
  }
  
  calculateWorkspaceScore(taskText, workspace) {
    const workspaceName = workspace.name.toLowerCase();
    let score = 0;
    const reasons = [];
    
    // Direct keyword matches
    const keywords = this.extractKeywords(taskText);
    
    for (const keyword of keywords) {
      if (workspaceName.includes(keyword)) {
        score += 5;
        reasons.push(`keyword match: "${keyword}"`);
      }
    }
    
    // Project context matches
    if (taskText.includes('nastygram') && workspaceName.includes('nastygram')) {
      score += 10;
      reasons.push('project context match: nastygram');
    }
    
    if (taskText.includes('labcorp') && workspaceName.includes('health')) {
      score += 8;
      reasons.push('health-related task');
    }
    
    // Personal vs work classification
    if (this.isPersonalTask(taskText) && workspaceName.includes('personal')) {
      score += 3;
      reasons.push('personal task classification');
    }
    
    if (this.isWorkTask(taskText) && (workspaceName.includes('dkc') || workspaceName.includes('dkdev'))) {
      score += 3;
      reasons.push('work task classification');
    }
    
    // Default score for general workspaces
    if (workspaceName.includes('personal') && score === 0) {
      score += 1;
      reasons.push('default personal workspace');
    }
    
    return {
      total: score,
      reasoning: reasons.join(', ') || 'no specific matches'
    };
  }
  
  findBestProject(taskText, projects) {
    if (!projects || projects.length === 0) return null;
    
    const projectMatches = projects.map(project => {
      const projectName = project.name.toLowerCase();
      let score = 0;
      
      // Direct keyword matches
      const keywords = this.extractKeywords(taskText);
      for (const keyword of keywords) {
        if (projectName.includes(keyword)) {
          score += 5;
        }
      }
      
      return { project, score };
    }).sort((a, b) => b.score - a.score);
    
    return projectMatches[0]?.score > 0 ? projectMatches[0].project : null;
  }
  
  extractKeywords(text) {
    // Extract meaningful keywords from task text
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !this.isStopWord(word));
    
    return [...new Set(words)]; // Remove duplicates
  }
  
  isStopWord(word) {
    const stopWords = ['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'boy', 'did', 'she', 'use', 'way', 'will', 'need', 'have', 'this', 'that', 'with', 'they'];
    return stopWords.includes(word);
  }
  
  isPersonalTask(text) {
    const personalKeywords = ['personal', 'home', 'health', 'doctor', 'appointment', 'family', 'vacation', 'shopping', 'errands'];
    return personalKeywords.some(keyword => text.includes(keyword));
  }
  
  isWorkTask(text) {
    const workKeywords = ['client', 'project', 'meeting', 'deadline', 'business', 'company', 'team', 'development', 'marketing'];
    return workKeywords.some(keyword => text.includes(keyword));
  }
  
  formatSuggestionMessage(suggestions) {
    if (suggestions.length === 0) return 'No workspace suggestions available.';
    
    let message = '🎯 **Workspace & Project Suggestions:**\n\n';
    
    suggestions.forEach((suggestion, index) => {
      message += `**${index + 1}. ${suggestion.task.title}**\n`;
      message += `📁 **${suggestion.workspace.name}**`;
      
      if (suggestion.project) {
        message += ` > ${suggestion.project.name}`;
      }
      
      message += `\n🎯 Confidence: ${suggestion.confidence}`;
      message += `\n💭 _${suggestion.reasoning}_\n\n`;
    });
    
    return message;
  }
}

export default WorkspaceMatcherService;