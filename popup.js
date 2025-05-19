class LinkedInScraper {
    constructor() {
        this.isScrapingBulk = false;
        this.bulkQueue = [];
        this.currentBulkIndex = 0;
        this.scrapedContacts = [];
        this.init();
    }

    async init() {
        // Check login status
        // await this.checkLoginStatus();
        
        // Load saved data
        await this.loadSavedData();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Update UI
        this.updateHistoryUI();
        this.updateBulkUI();
    }

    setupEventListeners() {
        // Profile scraping
        document.getElementById('scrapeProfile').addEventListener('click', () => this.scrapeCurrentProfile());
        
        // Bulk scraping
        document.getElementById('startBulkScrape').addEventListener('click', () => this.startBulkScrape());
        document.getElementById('pauseBulkScrape').addEventListener('click', () => this.pauseBulkScrape());
        
        // Delay slider
        const delaySlider = document.getElementById('scrapeDelay');
        delaySlider.addEventListener('input', (e) => {
            document.getElementById('delayValue').textContent = e.target.value;
        });
        
        // Export buttons
        document.getElementById('exportCSV').addEventListener('click', () => this.exportData('csv'));
        document.getElementById('exportJSON').addEventListener('click', () => this.exportData('json'));
        
        // Clear history
        document.getElementById('clearHistory').addEventListener('click', () => this.clearHistory());
        
        // Tab switching
        document.querySelectorAll('[data-bs-toggle="pill"]').forEach(tab => {
            tab.addEventListener('shown.bs.tab', (e) => {
                if (e.target.id === 'bulk-tab') {
                    this.refreshBulkQueue();
                }
            });
        });
    }

    async checkLoginStatus() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab.url.includes('linkedin.com')) {
                this.updateStatus('error', 'Not on LinkedIn');
                return false;
            }

            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: () => {
                    // Check for LinkedIn login indicators
                    const feedElement = document.querySelector('[data-test-id="extended-nav"]');
                    const loginButton = document.querySelector('[data-tracking-control-name="guest_homepage-basic_nav-header-signin"]');
                    return !loginButton && feedElement !== null;
                }
            });

            const isLoggedIn = results[0].result;
            
            if (isLoggedIn) {
                this.updateStatus('ready', 'Ready');
                return true;
            } else {
                this.updateStatus('error', 'Please login to LinkedIn');
                return false;
            }
        } catch (error) {
            console.error('Error checking login status:', error);
            this.updateStatus('error', 'Error checking status');
            return false;
        }
    }

    updateStatus(status, text) {
        const indicator = document.querySelector('.status-indicator');
        const statusText = document.getElementById('statusText');
        
        indicator.className = `status-indicator status-${status}`;
        statusText.textContent = text;
    }

    async scrapeCurrentProfile() {
        const button = document.getElementById('scrapeProfile');
        const spinner = document.getElementById('profileSpinner');
        const btnText = document.getElementById('profileBtnText');
        const resultDiv = document.getElementById('profileResult');
        
        try {
            // Show loading state
            button.disabled = true;
            spinner.classList.remove('d-none');
            btnText.textContent = 'Scraping...';
            this.updateStatus('scraping', 'Scraping profile...');
            
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Execute scraping script
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: this.extractProfileData
            });
            
            const contactData = results[0].result;
            
            if (contactData && contactData.name) {
                // Save to storage
                await this.saveContact(contactData);
                
                // Update UI
                this.displayProfileResult(contactData, resultDiv);
                this.updateStatus('ready', 'Profile scraped successfully');
                
                // Show notification
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icon48.png',
                    title: 'Profile Scraped',
                    message: `Successfully scraped: ${contactData.name}`
                });
            } else {
                resultDiv.innerHTML = '<div class="alert alert-danger">Failed to scrape profile data</div>';
                this.updateStatus('error', 'Scraping failed');
            }
        } catch (error) {
            console.error('Error scraping profile:', error);
            resultDiv.innerHTML = '<div class="alert alert-danger">Error occurred while scraping</div>';
            this.updateStatus('error', 'Scraping error');
        } finally {
            // Reset button state
            button.disabled = false;
            spinner.classList.add('d-none');
            btnText.textContent = 'Scrape Current Profile';
        }
    }

    // Function to be injected into LinkedIn page
    extractProfileData() {
        try {
            const profile = {};
            
            // Name
            const nameElement = document.querySelector('.text-heading-xlarge') || 
                              document.querySelector('h1.break-words') ||
                              document.querySelector('[data-anonymize="person-name"]');
            profile.name = nameElement ? nameElement.textContent.trim() : '';
            
            // Job title
            const titleElement = document.querySelector('.text-body-medium.break-words') ||
                               document.querySelector('.pv-text-details__left-panel .text-body-medium');
            profile.title = titleElement ? titleElement.textContent.trim() : '';
            
            // Company
            const companyElement = document.querySelector('[data-field="experience_company_logo"] .pv-entity__secondary-title') ||
                                 document.querySelector('.pv-entity__secondary-title') ||
                                 document.querySelector('[aria-label*="Current company"]');
            profile.company = companyElement ? companyElement.textContent.trim() : '';
            
            // Location
            const locationElement = document.querySelector('.text-body-small.inline.t-black--light.break-words') ||
                                  document.querySelector('[data-field="location_details"]') ||
                                  document.querySelector('.pv-text-details__left-panel .text-body-small');
            profile.location = locationElement ? locationElement.textContent.trim() : '';
            
            // Profile URL
            profile.profileUrl = window.location.href;
            
            // About section
            const aboutElement = document.querySelector('#about') ||
                                document.querySelector('[data-field="summary"]');
            if (aboutElement) {
                const aboutContent = aboutElement.closest('section')?.querySelector('.full-width') ||
                                   aboutElement.closest('section')?.querySelector('.pv-shared-text-with-see-more');
                profile.about = aboutContent ? aboutContent.textContent.trim() : '';
            }
            
            // Experience (current position)
            const experienceSection = document.querySelector('#experience');
            if (experienceSection) {
                const firstExperience = experienceSection.closest('section')?.querySelector('.artdeco-list__item');
                if (firstExperience) {
                    const positionTitle = firstExperience.querySelector('.mr1.t-bold span[aria-hidden="true"]');
                    const companyName = firstExperience.querySelector('.t-14.t-normal span[aria-hidden="true"]');
                    profile.currentPosition = positionTitle ? positionTitle.textContent.trim() : '';
                    if (!profile.company && companyName) {
                        profile.company = companyName.textContent.trim();
                    }
                }
            }
            
            // Contact info (if available)
            const contactSection = document.querySelector('[data-section="contactinfo"]');
            if (contactSection) {
                // Email
                const emailElement = contactSection.querySelector('[href^="mailto:"]');
                profile.email = emailElement ? emailElement.href.replace('mailto:', '') : '';
                
                // Phone
                const phoneElement = contactSection.querySelector('[href^="tel:"]');
                profile.phone = phoneElement ? phoneElement.href.replace('tel:', '') : '';
            }
            
            // Add timestamp
            profile.scrapedAt = new Date().toISOString();
            
            return profile;
        } catch (error) {
            console.error('Error extracting profile data:', error);
            return null;
        }
    }

    async startBulkScrape() {
        try {
            this.updateStatus('scraping', 'Preparing bulk scrape...');
            
            // Get search results
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: this.extractSearchResults
            });
            
            this.bulkQueue = results[0].result || [];
            
            if (this.bulkQueue.length === 0) {
                this.updateStatus('error', 'No search results found');
                return;
            }
            
            // Start scraping
            this.isScrapingBulk = true;
            this.currentBulkIndex = 0;
            this.updateBulkUI();
            this.processBulkQueue();
            
        } catch (error) {
            console.error('Error starting bulk scrape:', error);
            this.updateStatus('error', 'Error starting bulk scrape');
        }
    }

    // Function to extract search results
    extractSearchResults() {
        const results = [];
        
        // Different selectors for different LinkedIn pages
        const profileCards = document.querySelectorAll('.reusable-search__result-container') ||
                           document.querySelectorAll('[data-test-id="search-results-container"] .entity-result') ||
                           document.querySelectorAll('.search-result__wrapper');
        
        profileCards.forEach(card => {
            try {
                const profileLink = card.querySelector('a[href*="/in/"]') || 
                                  card.querySelector('a[data-control-name="search_srp_result"]');
                
                if (profileLink) {
                    const name = card.querySelector('.entity-result__title-text a span[aria-hidden="true"]') ||
                               card.querySelector('.actor-name') ||
                               card.querySelector('[data-anonymize="person-name"]');
                    
                    const title = card.querySelector('.entity-result__primary-subtitle') ||
                                card.querySelector('.subline-level-1');
                    
                    const company = card.querySelector('.entity-result__secondary-subtitle') ||
                                  card.querySelector('.subline-level-2');
                    
                    const location = card.querySelector('.entity-result__secondary-subtitle + .entity-result__secondary-subtitle') ||
                                   card.querySelector('[data-field="location"]');
                    
                    results.push({
                        name: name ? name.textContent.trim() : '',
                        title: title ? title.textContent.trim() : '',
                        company: company ? company.textContent.trim() : '',
                        location: location ? location.textContent.trim() : '',
                        profileUrl: profileLink.href,
                        scraped: false
                    });
                }
            } catch (error) {
                console.error('Error extracting card data:', error);
            }
        });
        
        return results;
    }

    async processBulkQueue() {
        if (!this.isScrapingBulk || this.currentBulkIndex >= this.bulkQueue.length) {
            this.completeBulkScrape();
            return;
        }
        
        const currentContact = this.bulkQueue[this.currentBulkIndex];
        this.updateStatus('scraping', `Scraping ${currentContact.name}...`);
        
        try {
            // Open profile in current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.update(tab.id, { url: currentContact.profileUrl });
            
            // Wait for page to load
            await this.waitForPageLoad(tab.id);
            
            // Scrape the profile
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: this.extractProfileData
            });
            
            const profileData = results[0].result;
            
            if (profileData && profileData.name) {
                // Merge with search result data
                const mergedData = { ...currentContact, ...profileData };
                await this.saveContact(mergedData);
                this.bulkQueue[this.currentBulkIndex].scraped = true;
            }
            
        } catch (error) {
            console.error('Error scraping profile:', error);
        }
        
        this.currentBulkIndex++;
        this.updateBulkUI();
        
        // Delay before next scrape
        const delay = document.getElementById('scrapeDelay').value * 1000;
        setTimeout(() => this.processBulkQueue(), delay);
    }

    async waitForPageLoad(tabId) {
        return new Promise((resolve) => {
            const checkLoaded = () => {
                chrome.scripting.executeScript({
                    target: { tabId },
                    function: () => document.readyState === 'complete'
                }).then(results => {
                    if (results[0].result) {
                        setTimeout(resolve, 1000); // Additional wait for dynamic content
                    } else {
                        setTimeout(checkLoaded, 500);
                    }
                });
            };
            checkLoaded();
        });
    }

    pauseBulkScrape() {
        this.isScrapingBulk = false;
        this.updateStatus('ready', 'Bulk scrape paused');
        this.updateBulkUI();
    }

    completeBulkScrape() {
        this.isScrapingBulk = false;
        this.updateStatus('ready', 'Bulk scrape completed');
        this.updateBulkUI();
        
        // Show notification
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'Bulk Scrape Complete',
            message: `Scraped ${this.scrapedContacts.length} contacts`
        });
    }

    async refreshBulkQueue() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab.url.includes('linkedin.com/search') && !tab.url.includes('linkedin.com/sales')) {
                document.getElementById('bulkResults').innerHTML = 
                    '<div class="alert alert-warning">Navigate to LinkedIn search results to use bulk scrape</div>';
                return;
            }
            
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: this.extractSearchResults
            });
            
            this.bulkQueue = results[0].result || [];
            this.updateBulkUI();
            
        } catch (error) {
            console.error('Error refreshing bulk queue:', error);
        }
    }

    updateBulkUI() {
        const scrapedCount = this.scrapedContacts.length;
        const queueCount = this.bulkQueue.length;
        const progress = queueCount > 0 ? (this.currentBulkIndex / queueCount) * 100 : 0;
        
        document.getElementById('scrapedCount').textContent = scrapedCount;
        document.getElementById('queueCount').textContent = queueCount;
        document.getElementById('scrapeProgress').style.width = `${progress}%`;
        
        const startBtn = document.getElementById('startBulkScrape');
        const pauseBtn = document.getElementById('pauseBulkScrape');
        const bulkSpinner = document.getElementById('bulkSpinner');
        const bulkBtnText = document.getElementById('bulkBtnText');
        
        if (this.isScrapingBulk) {
            startBtn.classList.add('d-none');
            pauseBtn.classList.remove('d-none');
            bulkSpinner.classList.remove('d-none');
            bulkBtnText.textContent = 'Scraping...';
        } else {
            startBtn.classList.remove('d-none');
            pauseBtn.classList.add('d-none');
            bulkSpinner.classList.add('d-none');
            bulkBtnText.textContent = 'Start Bulk Scrape';
        }
        
        // Update results display
        const resultsDiv = document.getElementById('bulkResults');
        if (queueCount > 0) {
            resultsDiv.innerHTML = `
                <div class="alert alert-info">
                    Found ${queueCount} profiles in search results
                    ${this.isScrapingBulk ? `<br>Currently scraping: ${this.currentBulkIndex + 1}/${queueCount}` : ''}
                </div>
            `;
        }
    }

    displayProfileResult(contact, container) {
        container.innerHTML = `
            <div class="contact-item">
                <strong>${contact.name || 'N/A'}</strong><br>
                <small>
                    ${contact.title || 'N/A'}<br>
                    ${contact.company || 'N/A'}<br>
                    ${contact.location || 'N/A'}
                </small>
            </div>
        `;
    }

    async saveContact(contact) {
        this.scrapedContacts.push(contact);
        await chrome.storage.local.set({ 'scrapedContacts': this.scrapedContacts });
    }

    async loadSavedData() {
        const result = await chrome.storage.local.get(['scrapedContacts']);
        this.scrapedContacts = result.scrapedContacts || [];
    }

    updateHistoryUI() {
        const totalContacts = this.scrapedContacts.length;
        document.getElementById('totalContacts').textContent = totalContacts;
        
        const historyList = document.getElementById('historyList');
        
        if (totalContacts === 0) {
            historyList.innerHTML = '<div class="alert alert-info">No contacts scraped yet</div>';
            return;
        }
        
        const recentContacts = this.scrapedContacts.slice(-10).reverse();
        historyList.innerHTML = recentContacts.map(contact => `
            <div class="contact-item">
                <strong>${contact.name || 'N/A'}</strong><br>
                <small>
                    ${contact.title || 'N/A'}<br>
                    ${contact.company || 'N/A'}<br>
                    ${contact.location || 'N/A'}<br>
                    ${contact.email || 'No email'}<br>
                    <em>Scraped: ${new Date(contact.scrapedAt).toLocaleDateString()}</em>
                </small>
            </div>
        `).join('');
    }

    async exportData(format) {
        if (this.scrapedContacts.length === 0) {
            alert('No data to export');
            return;
        }
        
        let content, filename, mimeType;
        
        if (format === 'csv') {
            content = this.convertToCSV(this.scrapedContacts);
            filename = `linkedin_contacts_${new Date().toISOString().split('T')[0]}.csv`;
            mimeType = 'text/csv';
        } else {
            content = JSON.stringify(this.scrapedContacts, null, 2);
            filename = `linkedin_contacts_${new Date().toISOString().split('T')[0]}.json`;
            mimeType = 'application/json';
        }
        
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        
        URL.revokeObjectURL(url);
    }

    convertToCSV(data) {
        if (data.length === 0) return '';
        
        const headers = Object.keys(data[0]);
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

    async clearHistory() {
        if (confirm('Are you sure you want to clear all scraped data?')) {
            this.scrapedContacts = [];
            await chrome.storage.local.set({ 'scrapedContacts': [] });
            this.updateHistoryUI();
            this.updateBulkUI();
        }
    }
}

// Initialize the scraper when popup loads
document.addEventListener('DOMContentLoaded', () => {
    new LinkedInScraper();
});