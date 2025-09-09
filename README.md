# Projectize Slack Agent 🚀

AI-powered Slack agent that intelligently extracts actionable tasks from conversations and syncs them to Motion.

## Features

- **Smart Task Extraction**: Uses Claude AI to identify actionable tasks from natural conversation
- **Motion Integration**: Seamlessly syncs tasks to your Motion workspace
- **Interactive Preview**: Review and edit tasks before creation
- **Channel Mapping**: Automatic project mapping based on Slack channels
- **Error Handling**: Robust retry logic for failed syncs

## Quick Start

1. **Clone and Install**
   ```bash
   git clone https://github.com/yourusername/projectizeslack.git
   cd projectizeslack
   npm install
   ```

2. **Environment Setup**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Database Setup**
   ```bash
   npm run setup:supabase
   ```

4. **Run Development Server**
   ```bash
   npm run dev
   ```

## Setup Scripts

- `npm run setup:slack` - Configure Slack app
- `npm run setup:motion` - Configure Motion integration  
- `npm run setup:supabase` - Initialize database schema

## Environment Variables

See `.env.example` for required configuration:

- **Slack**: Bot token, app token, signing secret
- **Motion**: API key and workspace ID
- **Claude**: Anthropic API key
- **Supabase**: Database connection details

## Usage

1. Invite @projectize to your Slack channel
2. Mention @projectize or quote text to extract tasks
3. Review and approve task previews
4. Tasks automatically sync to Motion

## Project Structure

```
src/
├── app.js              # Main Slack Bolt application
├── handlers/           # Message event handlers
├── services/           # AI and API integrations  
├── utils/              # Parsing and validation utilities
└── setup/              # Configuration scripts
```

## Documentation

- [PRD.md](PRD.md) - Complete product requirements
- [Environment Setup](docs/setup.md) - Detailed configuration guide
- [API Integration](docs/api.md) - Motion and Claude API details

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details