# SiYuan-Karakeep Sync Plugin

## Overview

SiYuan-Karakeep is a plugin for [SiYuan Note](https://github.com/siyuan-note/siyuan) that provides one-way synchronization from [Karakeep](https://karakeep.app/) (formerly known as Hoarder) to SiYuan. This allows you to automatically save your Karakeep bookmarks as documents in your SiYuan notebooks.

## Features

- **One-way synchronization** from Karakeep to SiYuan
- **Automatic sync** at configurable intervals
- **Manual sync** on demand
- **Selective sync** based on bookmark attributes:
  - Option to exclude archived bookmarks
  - Option to only sync favorited bookmarks
  - Option to exclude bookmarks with specific tags
- **Asset handling** - choose to download images locally or link externally
- **Metadata preservation** - Karakeep metadata is saved as attributes in SiYuan documents
- **Update handling** - option to update existing documents when bookmarks change

## Installation

1. Download the latest release from the [GitHub releases page](https://github.com/pablocpas/siyuan-karakeep/releases)
2. Extract the zip file into your SiYuan plugins directory:
   - Windows: `{workspace}/data/plugins/`
   - macOS: `{workspace}/data/plugins/`
   - Linux: `{workspace}/data/plugins/`
   - Android/iOS: `{workspace}/data/plugins/`
3. Restart SiYuan or reload plugins
4. Enable the plugin in SiYuan's marketplace tab

## Configuration

After installation, you'll need to configure the plugin with:

1. **Karakeep API Key** - Get this from your Karakeep settings
2. **API Endpoint** - Usually `https://api.hoarder.app/api/v1` (default) or your self-hosted URL
3. **Target SiYuan Notebook** - Select which notebook should receive your bookmarks
4. **Sync Interval** - How often (in minutes) automatic synchronization should occur (set to 0 to disable)
5. **Excluded Tags** - Comma-separated list of tags; bookmarks with these tags won't be synced (unless favorited)
6. **Update Settings**:
   - Enable/disable updating existing documents when bookmarks change
   - Choose to exclude archived bookmarks
   - Decide to only sync favorites
   - Option to download assets locally vs. linking externally

## Usage

Once configured, the plugin will:

1. Automatically sync your Karakeep bookmarks to SiYuan at the specified interval
2. You can trigger a manual sync using the "Sync Now" button in settings
3. You can also use the command palette and trigger "Sync Karakeep Bookmarks"

Bookmarks will be created as Markdown documents in your selected notebook with:
- Title based on bookmark title or URL
- Image preview (if available)
- URL and description
- Bookmark summary and notes
- Link back to Karakeep

## Document Structure

Each synchronized bookmark will create a document with:

```markdown
# [Bookmark Title]

[Image if available]

**URL:** [URL](URL)

## Summary

[Bookmark summary if available]

## Description

[Bookmark description if available]

## Notes

[Your notes from Karakeep]

----
[View in Karakeep](link to original bookmark)
```

## Troubleshooting

- **API Authentication Issues**: Ensure your API key is correct and has not expired
- **Sync Failures**: Check console logs for detailed error messages
- **Missing Documents**: Verify your notebook selection and filter settings
- **Update Issues**: Make sure "Update Existing Documents" is enabled if you want changes from Karakeep to propagate

## Credits

- Developed by Pablo Caño
- Based on Karakeep (formerly Hoarder) API
- Made for the SiYuan Note community

## License

[MIT License](LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.