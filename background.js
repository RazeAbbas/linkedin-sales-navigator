class BackgroundService {
    constructor() {
        this.init();
    }

    init() {
        // Handle extension installation
        chrome.runtime.onInstalled.addListener((details) => {
            this.handleInstallation(details);
        });

        // Handle messages from content script and popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep message channel open for async responses
        });

        // Handle tab updates for auto-detection
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            this.handleTabUpdate(tabId, changeInfo, tab);
        });

        // Handle notification clicks
        chrome.notifications.onClicked.addListener((notificationId) => {
            this.handleNotificationClick(notificationId);
        });

        // Set up periodic cleanup
        this.setupPeriodicCleanup();
    }

    handleInstallation(details) {
        // Initialize default settings
        chrome.storage.local.set({
            'scrapedContacts': [],
            'settings': {
                'autoScrapeDelay': 2,
                'maxRetries': 3,
                'enableNotifications': true,
                'exportFormat': 'csv'
            },
            'lastCleanup': Date.now()
        });

        // Show welcome notification
        if (details.reason === 'install') {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: 'LinkedIn Scraper Installed',
                message: 'Extension ready! Click the icon to start scraping.'
            });
        }
    }

    async handleMessage(message, sender, sendResponse) {
        try {
            switch (message.action) {
                case 'getStorageData':
                    const data = await chrome.storage.local.get(message.keys);
                    sendResponse({ success: true, data });
                    break;

                case 'setStorageData':
                    await chrome.storage.local.set(message.data);
                    sendResponse({ success: true });
                    break;

                case 'openLinkedInTab':
                    const tab = await chrome.tabs.create({ url: 'https://www.linkedin.com' });
                    sendResponse({ success: true, tabId: tab.id });
                    break;

                case 'getCurrentTab':
                    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    sendResponse({ success: true, tab: currentTab });
                    break;

                case 'showNotification':
                    chrome.notifications.create({
                        type: message.type || 'basic',
                        iconUrl: 'icon48.png',
                        title: message.title,
                        message: message.message
                    });
                    sendResponse({ success: true });
                    break;

                case 'exportData':
                    const exportResult = await this.handleDataExport(message.data, message.format);
                    sendResponse(exportResult);
                    break;

                case 'cleanupOldData':
                    const cleanupResult = await this.cleanupOldData(message.daysToKeep);
                    sendResponse(cleanupResult);
                    break;

                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Background script error:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    handleTabUpdate(tabId, changeInfo, tab) {
        // Auto-detect LinkedIn pages and update badge
        if (changeInfo.status === 'complete' && tab.url) {
            if (tab.url.includes('linkedin.com')) {
                this.updateBadge(tabId, tab.url);
            } else {
                chrome.action.setBadgeText({ text: '', tabId });
            }
        }
    }

    updateBadge(tabId, url) {
        let badgeText = '';
        let badgeColor = '#0066cc';

        if (url.includes('/in/')) {
            badgeText = 'P'; // Profile
            badgeColor = '#28a745';
        } else if (url.includes('/search/results/people/') || url.includes('/sales/search/people/')) {
            badgeText = 'S'; // Search
            badgeColor = '#ffc107';
        } else if (url.includes('/feed/')) {
            badgeText = 'F'; // Feed
            badgeColor = '#17a2b8';
        }

        chrome.action.setBadgeText({ text: badgeText, tabId });
        chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId });
    }

    handleNotificationClick(notificationId) {
        // Handle notification clicks - could open extension popup or specific LinkedIn page
        chrome.action.openPopup();
    }

    async handleDataExport(contacts, format) {
        try {
            let content, mimeType;

            if (format === 'csv') {
                content = this.convertToCSV(contacts);
                mimeType = 'text/csv';
            } else if (format === 'json') {
                content = JSON.stringify(contacts, null, 2);
                mimeType = 'application/json';
            } else if (format === 'xlsx') {
                // For XLSX export, we'd need to use a library or send to popup
                return { success: false, error: 'XLSX export not supported in background script' };
            }

            // Use chrome.downloads API to trigger download
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const filename = `linkedin_contacts_${new Date().toISOString().split('T')[0]}.${format}`;

            await chrome.downloads.download({
                url: url,
                filename: filename,
                saveAs: true
            });

            return { success: true, filename };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    convertToCSV(data) {
        if (!data || data.length === 0) return '';

        const headers = [...new Set(data.flatMap(contact => Object.keys(contact)))];
        const csvRows = [headers.join(',')];

        for (const contact of data) {
            const values = headers.map(header => {
                const value = contact[header] || '';
                return `"${value.toString().replace(/"/g, '""')}"`;
            });
            csvRows.push(values.join(','));
        }

        return csvRows.join('\n');
    }

    async cleanupOldData(daysToKeep = 30) {
        try {
            const { scrapedContacts } = await chrome.storage.local.get(['scrapedContacts']);
            
            if (!scrapedContacts || scrapedContacts.length === 0) {
                return { success: true, message: 'No data to clean' };
            }

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            const filteredContacts = scrapedContacts.filter(contact => {
                const scrapedDate = new Date(contact.scrapedAt);
                return scrapedDate > cutoffDate;
            });

            await chrome.storage.local.set({
                'scrapedContacts': filteredContacts,
                'lastCleanup': Date.now()
            });

            const removedCount = scrapedContacts.length - filteredContacts.length;
            return {
                success: true,
                message: `Removed ${removedCount} old contacts`,
                removedCount,
                remainingCount: filteredContacts.length
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    setupPeriodicCleanup() {
        // Clean up old data weekly
        const weeklyCleanup = () => {
            this.cleanupOldData(30); // Keep data for 30 days
        };

        // Initial cleanup after 1 hour
        setTimeout(weeklyCleanup, 60 * 60 * 1000);

        // Then weekly
        setInterval(weeklyCleanup, 7 * 24 * 60 * 60 * 1000);
    }

    // Utility methods
    async getTabByUrl(url) {
        const tabs = await chrome.tabs.query({ url: url + '*' });
        return tabs[0] || null;
    }

    async createOrFocusTab(url) {
        const existingTab = await this.getTabByUrl(url);
        
        if (existingTab) {
            await chrome.tabs.update(existingTab.id, { active: true });
            return existingTab;
        } else {
            return await chrome.tabs.create({ url });
        }
    }
}

// Initialize the background service
new BackgroundService();