class LinkedInContentScript {
    constructor() {
        this.initialized = false;
        this.observer = null;
        this.init();
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;
        
        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep message channel open for async response
        });
        
        // Monitor page changes
        this.setupPageMonitoring();
        
        // Add visual indicators for scrapable elements
        this.addVisualIndicators();
    }

    async handleMessage(message, sender, sendResponse) {
        try {
            switch (message.action) {
                case 'checkLoginStatus':
                    const isLoggedIn = this.checkLoginStatus();
                    sendResponse({ success: true, isLoggedIn });
                    break;
                    
                case 'scrapeCurrentProfile':
                    const profileData = this.extractProfileData();
                    sendResponse({ success: true, data: profileData });
                    break;
                    
                case 'extractSearchResults':
                    const searchResults = this.extractSearchResults();
                    sendResponse({ success: true, data: searchResults });
                    break;
                    
                case 'getPageType':
                    const pageType = this.getPageType();
                    sendResponse({ success: true, pageType });
                    break;
                    
                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Error handling message:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    checkLoginStatus() {
        // Multiple ways to check if user is logged in
        const indicators = [
            // Check for navigation elements
            document.querySelector('[data-test-id="extended-nav"]'),
            document.querySelector('.global-nav__me'),
            document.querySelector('.nav-item__profile-member-photo'),
            
            // Check for feed elements
            document.querySelector('[data-test-id="feed"]'),
            document.querySelector('.feed-container-theme'),
            
            // Check absence of login/signup buttons
            !document.querySelector('[data-tracking-control-name="guest_homepage-basic_nav-header-signin"]'),
            !document.querySelector('.main__sign-in-link')
        ];
        
        // User is logged in if most indicators are positive
        const positiveIndicators = indicators.filter(Boolean).length;
        return positiveIndicators >= 2;
    }

    getPageType() {
        const url = window.location.href;
        
        if (url.includes('/in/')) {
            return 'profile';
        } else if (url.includes('/search/results/people/') || url.includes('/sales/search/people/')) {
            return 'search';
        } else if (url.includes('/feed/')) {
            return 'feed';
        } else if (url.includes('/mynetwork/')) {
            return 'network';
        } else {
            return 'other';
        }
    }

    extractProfileData() {
        const profile = {};
        
        try {
            // Name - Multiple selectors for different LinkedIn layouts
            const nameSelectors = [
                '.text-heading-xlarge',
                'h1.break-words',
                '[data-anonymize="person-name"]',
                '.pv-text-details__left-panel h1',
                '.ph5 h1'
            ];
            
            for (const selector of nameSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    profile.name = element.textContent.trim();
                    break;
                }
            }
            
            // Job title
            const titleSelectors = [
                '.text-body-medium.break-words',
                '.pv-text-details__left-panel .text-body-medium',
                '.ph5 .text-body-medium'
            ];
            
            for (const selector of titleSelectors) {
                const element = document.querySelector(selector);
                if (element && !element.querySelector('button')) { // Avoid "see more" buttons
                    profile.title = element.textContent.trim();
                    break;
                }
            }
            
            // Location
            const locationSelectors = [
                '.text-body-small.inline.t-black--light.break-words',
                '[data-field="location_details"]',
                '.pv-text-details__left-panel .text-body-small'
            ];
            
            for (const selector of locationSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    profile.location = element.textContent.trim();
                    break;
                }
            }
            
            // Current position and company from experience section
            const experienceSection = document.querySelector('#experience');
            if (experienceSection) {
                const experienceItem = experienceSection.closest('section')?.querySelector('.artdeco-list__item');
                if (experienceItem) {
                    // Position title
                    const positionElement = experienceItem.querySelector('.mr1.t-bold span[aria-hidden="true"]') ||
                                          experienceItem.querySelector('.pvs-entity__caption-wrapper .visually-hidden');
                    if (positionElement) {
                        profile.currentPosition = positionElement.textContent.trim();
                    }
                    
                    // Company name
                    const companyElement = experienceItem.querySelector('.t-14.t-normal span[aria-hidden="true"]') ||
                                         experienceItem.querySelector('[data-field="experience_company_logo"] .pv-entity__secondary-title');
                    if (companyElement) {
                        profile.company = companyElement.textContent.trim();
                    }
                }
            }
            
            // About section
            const aboutSection = document.querySelector('#about');
            if (aboutSection) {
                const aboutContent = aboutSection.closest('section')?.querySelector('.full-width') ||
                                   aboutSection.closest('section')?.querySelector('.pv-shared-text-with-see-more') ||
                                   aboutSection.closest('section')?.querySelector('.pvs-text-details__right-panel');
                if (aboutContent) {
                    profile.about = aboutContent.textContent.trim();
                }
            }
            
            // Education
            const educationSection = document.querySelector('#education');
            if (educationSection) {
                const educationItem = educationSection.closest('section')?.querySelector('.artdeco-list__item');
                if (educationItem) {
                    const schoolElement = educationItem.querySelector('.pv-entity__school-name') ||
                                        educationItem.querySelector('[data-field="school_name"]');
                    const degreeElement = educationItem.querySelector('.pv-entity__degree-name') ||
                                        educationItem.querySelector('[data-field="field_of_study"]');
                    
                    if (schoolElement) profile.education = schoolElement.textContent.trim();
                    if (degreeElement) profile.degree = degreeElement.textContent.trim();
                }
            }
            
            // Contact information (if available in contact info section)
            this.extractContactInfo(profile);
            
            // Profile URL
            profile.profileUrl = window.location.href;
            
            // Connections count
            const connectionsElement = document.querySelector('.pv-top-card--list .t-bold') ||
                                     document.querySelector('[data-field="connections_count"]');
            if (connectionsElement) {
                profile.connections = connectionsElement.textContent.trim();
            }
            
            // Profile image
            const imageElement = document.querySelector('.pv-top-card__photo') ||
                               document.querySelector('.presence-entity__image');
            if (imageElement) {
                profile.imageUrl = imageElement.src;
            }
            
            // Add timestamp and page type
            profile.scrapedAt = new Date().toISOString();
            profile.pageType = 'profile';
            
            // Validate that we got meaningful data
            if (!profile.name && !profile.title) {
                throw new Error('Could not extract basic profile information');
            }
            
            return profile;
            
        } catch (error) {
            console.error('Error extracting profile data:', error);
            throw error;
        }
    }

    extractContactInfo(profile) {
        // Try to find contact info in various places
        
        // Check for contact info section
        const contactSection = document.querySelector('[data-section="contactinfo"]') ||
                             document.querySelector('.pv-contact-info');
        
        if (contactSection) {
            // Email
            const emailElement = contactSection.querySelector('[href^="mailto:"]');
            if (emailElement) {
                profile.email = emailElement.href.replace('mailto:', '');
            }
            
            // Phone
            const phoneElement = contactSection.querySelector('[href^="tel:"]');
            if (phoneElement) {
                profile.phone = phoneElement.href.replace('tel:', '');
            }
            
            // Website
            const websiteElement = contactSection.querySelector('[href^="http"]');
            if (websiteElement) {
                profile.website = websiteElement.href;
            }
        }
        
        // Check for contact info in profile header
        const headerContactElements = document.querySelectorAll('.pv-text-details__left-panel a');
        headerContactElements.forEach(element => {
            const href = element.href;
            if (href.startsWith('mailto:') && !profile.email) {
                profile.email = href.replace('mailto:', '');
            } else if (href.startsWith('tel:') && !profile.phone) {
                profile.phone = href.replace('tel:', '');
            }
        });
    }

    extractSearchResults() {
        const results = [];
        
        try {
            // Different selectors for different types of search pages
            let resultCards = [];
            
            // Regular people search
            if (document.querySelector('.search-results-container')) {
                resultCards = document.querySelectorAll('.reusable-search__result-container');
            }
            // Sales Navigator search
            else if (document.querySelector('.search-results__list')) {
                resultCards = document.querySelectorAll('.search-results__result-item');
            }
            // Alternative search layout
            else {
                resultCards = document.querySelectorAll('[data-test-id="search-result"]') ||
                           document.querySelectorAll('.entity-result');
            }
            
            resultCards.forEach((card, index) => {
                try {
                    const result = this.extractResultCardData(card);
                    if (result && result.profileUrl) {
                        result.searchIndex = index;
                        results.push(result);
                    }
                } catch (error) {
                    console.error('Error extracting result card:', error);
                }
            });
            
            return results;
            
        } catch (error) {
            console.error('Error extracting search results:', error);
            throw error;
        }
    }

    extractResultCardData(card) {
        const result = {};
        
        // Profile URL - most important, must be present
        const profileLink = card.querySelector('a[href*="/in/"]') ||
                          card.querySelector('a[data-control-name*="search_srp"]') ||
                          card.querySelector('.app-aware-link');
        
        if (!profileLink) return null;
        
        result.profileUrl = profileLink.href;
        
        // Name
        const nameSelectors = [
            '.entity-result__title-text a span[aria-hidden="true"]',
            '.actor-name',
            '[data-anonymize="person-name"]',
            '.search-result__result-link',
            '.result-card__full-name'
        ];
        
        for (const selector of nameSelectors) {
            const element = card.querySelector(selector);
            if (element) {
                result.name = element.textContent.trim();
                break;
            }
        }
        
        // Job title
        const titleSelectors = [
            '.entity-result__primary-subtitle',
            '.subline-level-1',
            '.result-card__subtitle',
            '.search-result__snippets .text-body-small'
        ];
        
        for (const selector of titleSelectors) {
            const element = card.querySelector(selector);
            if (element) {
                result.title = element.textContent.trim();
                break;
            }
        }
        
        // Company
        const companySelectors = [
            '.entity-result__secondary-subtitle',
            '.subline-level-2',
            '.result-card__snippet--secondary',
            '[data-entity-urn*="company"]'
        ];
        
        for (const selector of companySelectors) {
            const element = card.querySelector(selector);
            if (element) {
                result.company = element.textContent.trim();
                break;
            }
        }
        
        // Location
        const locationSelectors = [
            '.entity-result__secondary-subtitle + .entity-result__secondary-subtitle',
            '[data-field="location"]',
            '.result-card__misc-item'
        ];
        
        for (const selector of locationSelectors) {
            const element = card.querySelector(selector);
            if (element && element.textContent.includes(',')) { // Likely a location if it contains comma
                result.location = element.textContent.trim();
                break;
            }
        }
        
        // Extract additional fields if available
        result.mutual_connections = this.extractMutualConnections(card);
        result.premium = card.querySelector('.premium-icon') ? true : false;
        result.open_link = card.querySelector('[data-control-name*="open_link"]') ? true : false;
        
        // Add extraction metadata
        result.extractedAt = new Date().toISOString();
        result.pageType = 'search';
        
        return result;
    }

    extractMutualConnections(card) {
        const mutualElement = card.querySelector('[data-field="mutual_connections"]') ||
                             card.querySelector('.subline-level-3') ||
                             card.querySelector('.result-card__misc-item:last-child');
        
        if (mutualElement && mutualElement.textContent.includes('mutual')) {
            return mutualElement.textContent.trim();
        }
        return null;
    }

    setupPageMonitoring() {
        // Monitor for page changes (SPA navigation)
        this.observer = new MutationObserver((mutations) => {
            const hasNavigated = mutations.some(mutation => 
                mutation.type === 'childList' && 
                mutation.target.tagName === 'BODY'
            );
            
            if (hasNavigated) {
                // Page changed, update visual indicators
                setTimeout(() => this.addVisualIndicators(), 1000);
            }
        });
        
        this.observer.observe(document.body, {
            childList: true,
            subtree: false
        });
        
        // Also listen for URL changes
        let currentUrl = window.location.href;
        setInterval(() => {
            if (window.location.href !== currentUrl) {
                currentUrl = window.location.href;
                setTimeout(() => this.addVisualIndicators(), 1000);
            }
        }, 1000);
    }

    addVisualIndicators() {
        // Remove existing indicators
        document.querySelectorAll('.linkedin-scraper-indicator').forEach(el => el.remove());
        
        const pageType = this.getPageType();
        
        if (pageType === 'profile') {
            this.addProfileIndicators();
        } else if (pageType === 'search') {
            this.addSearchIndicators();
        }
    }

    addProfileIndicators() {
        // Add indicator to profile section
        const profileSection = document.querySelector('.pv-text-details__left-panel') ||
                              document.querySelector('.ph5');
        
        if (profileSection) {
            const indicator = this.createIndicator('Profile scrapable', '#28a745');
            profileSection.insertBefore(indicator, profileSection.firstChild);
        }
    }

    addSearchIndicators() {
        // Add indicators to each search result
        const resultCards = document.querySelectorAll('.reusable-search__result-container') ||
                           document.querySelectorAll('.entity-result') ||
                           document.querySelectorAll('.search-results__result-item');
        
        resultCards.forEach(card => {
            if (!card.querySelector('.linkedin-scraper-indicator')) {
                const indicator = this.createIndicator('Scrapable', '#17a2b8', 'small');
                card.style.position = 'relative';
                card.appendChild(indicator);
            }
        });
    }

    createIndicator(text, color, size = 'normal') {
        const indicator = document.createElement('div');
        indicator.className = 'linkedin-scraper-indicator';
        indicator.textContent = text;
        indicator.style.cssText = `
            position: absolute;
            top: 5px;
            right: 5px;
            background: ${color};
            color: white;
            padding: ${size === 'small' ? '2px 6px' : '4px 8px'};
            border-radius: 3px;
            font-size: ${size === 'small' ? '10px' : '12px'};
            font-weight: bold;
            z-index: 1000;
            pointer-events: none;
        `;
        return indicator;
    }

    // Utility method to wait for elements to load
    waitForElement(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element ${selector} not found within ${timeout}ms`));
            }, timeout);
        });
    }

    // Cleanup method
    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
        document.querySelectorAll('.linkedin-scraper-indicator').forEach(el => el.remove());
    }
}

// Initialize the content script
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new LinkedInContentScript();
    });
} else {
    new LinkedInContentScript();
}
