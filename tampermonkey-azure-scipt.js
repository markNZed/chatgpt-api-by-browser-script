// ==UserScript==
// @name         Azure API By Browser Script
// @namespace    http://tampermonkey.net/
// @version      2.9
// @match        https://oai.azure.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=openai.com
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const log = (...args) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`${timestamp} chatgpt-api-by-browser-script`, ...args);
    }
    log('Script initialized');

    const WS_URL = `ws://localhost:8765`;
    log('WebSocket URL:', WS_URL);

    function sleep(time) {
        return new Promise((resolve) => setTimeout(resolve, time));
    }

    async function waitForElement(selector, timeout = 10000) {
        const intervalTime = 500;
        let elapsedTime = 0;
        while (elapsedTime < timeout) {
            const element = document.querySelector(selector);
            if (element) {
                return element;
            }
            await sleep(intervalTime);
            elapsedTime += intervalTime;
        }
        return null;
    }

    // Main app class
    class App {
        constructor() {
            this.socket = null;
            this.observer = null;
            this.stop = false;
            this.dom = null;
            this.lastText = null; // Track the last message text
            this.currentRequestId = null; // To correlate responses
            this.debounceTimer = null;
            this.debounceDelay = 1000; // 1 second
            this.reconnectInterval = 2000; // 2 seconds
            this.maxReconnectInterval = 30000; // 30 seconds
        }

        async start(data) {
            log('Start method called with data:', data);
            const startTime = Date.now();

            // Parse the incoming data
            let parsedData;
            try {
                parsedData = JSON.parse(data.text);
                log('Parsed data:', parsedData);
            } catch (error) {
                log('Error parsing data:', error);
                return;
            }

            const { messages, model, newChat } = parsedData;

            this.stop = false;
            log('Starting to send a new message');

            // Check if messages array is valid
            if (!Array.isArray(messages) || messages.length === 0) {
                log('Error: Messages array is empty or invalid');
                return;
            }

            // Extract the last user message to send
            const lastMessage = messages[messages.length - 1];
            if (!lastMessage || !lastMessage.content) {
                log('Error: No valid message content found in the last message');
                return;
            }

            const messageContent = lastMessage.content;
            log('Message content to send:', messageContent);

            // Handle newChat flag
            if (newChat) {
                log('New chat flag detected, initiating new conversation.');
                await this.clickNewChatButton();
                log('New conversation initiated.');
                await sleep(500);
            }

            // Inject the message into the ChatGPT interface
            const promptTextarea = await waitForElement('[aria-label="User message"]', 10000);
            if (promptTextarea) {
                log('Prompt textarea found, inserting message content');
                await this.insertText(promptTextarea, messageContent);
                const sendButton = await this.waitForButton('button[data-automation-id="chatControlButton"][aria-label="Send"]', true);
                if (sendButton) {
                    sendButton.click();
                    log('Send button clicked');
                } else {
                    log('Error: Send button is still disabled after waiting');
                }
                await this.waitForButton('button[data-automation-id="chatControlButton"][aria-label="Stop"]');
            } else {
                log('Error: Prompt textarea not found');
            }

            this.observeMutations();

            log(`Start method completed in ${Date.now() - startTime}ms`);
        }

        async insertText(element, text) {
            try {
                // Focus the editor to ensure it can receive the paste event
                element.focus();

                // Create a DataTransfer object and set the plain text data
                const clipboardData = new DataTransfer();
                clipboardData.setData('text/plain', text);

                // Create the paste event with the clipboardData
                const pasteEvent = new Event('paste', {
                    bubbles: true,
                    cancelable: true,
                });

                // Define the clipboardData property on the event
                Object.defineProperty(pasteEvent, 'clipboardData', {
                    value: clipboardData,
                });

                // Dispatch the paste event on the editor
                element.dispatchEvent(pasteEvent);

                log(`Simulated paste of "${text}" into the editor.`);
            } catch (error) {
                log('Error during simulatePaste:', error);
            }
        }

        // Helper function to wait for the send button to become enabled
        async waitForButton(buttonSelector, checkEnabled = false, timeout = 5000) {
            const intervalTime = 500; // Check every 500ms
            let elapsedTime = 0;
            while (elapsedTime < timeout) {
                const button = document.querySelector(buttonSelector);
                if (button) {
                    if (checkEnabled) {
                        if (!button.disabled) {
                            log('Button found and enabled:', buttonSelector);
                            return button;
                        } else {
                            log('Button is disabled, waiting...', buttonSelector);
                        }
                    } else {
                        log('Button found:', buttonSelector);
                        return button;
                    }
                } else {
                    log('Button is missing, waiting...', buttonSelector);
                }
                await sleep(intervalTime);
                elapsedTime += intervalTime;
            }
            log('Button did not become enabled within the timeout period:', buttonSelector);
            return null;
        }

        // Helper function to wait for and click the "New Chat" button
        async clickNewChatButton() {
            const newChatButtonSelector = '[data-bi-cn="cg_chatsession_clear-chat"]'; // Update if necessary
            const newChatButton = await this.waitForButton(newChatButtonSelector);
            if (newChatButton) {
                newChatButton.click();
                log('New Chat button clicked');
            } else {
                log('Error: Unable to click New Chat button');
            }
            const confirmButtonSelector = '[data-bi-cn="cg_clearchatconfirmationdialog_clear"]';
            const confirmChatButton = await this.waitForButton(confirmButtonSelector);
            if (confirmChatButton) {
                confirmChatButton.click();
                log('Confirm button clicked');
            } else {
                log('Error: Unable to click confirm button');
            }
        }

        async observeMutations() {
            log('Setting up MutationObserver');

            // Select the <main> element to observe for changes
            const mainElement = document.querySelector('#chatGptChatRegion');
            if (!mainElement) {
                log('Error: <main> element not found, cannot observe mutations');
                return;
            }

            let isStart = false;
            this.observer = new MutationObserver(async (mutations) => {
                log('DOM mutations detected:', mutations);
                // Loop through each mutation and only process relevant ones
                // Filter mutations that are within the <main> element and match the relevant selector
                const relevantMutations = mutations.filter(mutation => {
                    const isWithinMain = mainElement.contains(mutation.target); // Ensure mutation happens within <main>
                    return isWithinMain;
                });

                let startButton = document.querySelector('button[data-automation-id="chatControlButton"][aria-label="Send"]');
                if (startButton) {
                    isStart = true;
                }

                // Clear any existing debounce timer
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }

                // Set a new debounce timer
                this.debounceTimer = setTimeout(async () => {
                    const list = [...document.querySelectorAll('[data-automation-id="aiBubbleContent"]')];
                    const last = list[list.length - 1];
                    if (!last && !startButton) {
                        log('Error: No last message found');
                        return;
                    }

                    // Select all divs with class 'bubbleContent'
                    const bubbleContentDivs = document.querySelectorAll('.bubbleContent');

                    if (!bubbleContentDivs || bubbleContentDivs.length === 0) {
                        log('Error: bubbleContentDivs not found');
                        return;
                    }

                    // Select the last 'bubbleContent' div
                    const bubbleContentDiv = bubbleContentDivs[bubbleContentDivs.length - 1];

                    // Now select the <p> element inside the last bubbleContent div
                    const paragraph = bubbleContentDiv.querySelector('p');

                    if (!paragraph) {
                        log('Error: Paragraph element not found inside last bubbleContentDiv');
                        return;
                    }

                    // Get the text content from the <p> element
                    const lastText = paragraph.textContent;
                  
                    if ((!lastText || lastText === this.lastText) && !startButton) {
                        log('Error: Last message text not found or unchanged');
                        return;
                    }

                    this.lastText = lastText;
                    log('Sending answer back to server:', lastText);
                    this.socket.send(
                        JSON.stringify({
                            type: 'answer',
                            text: lastText,
                        })
                    );

                    if (startButton) {
                        log('Start button found, disconnecting observer');
                        this.observer.disconnect();

                        if (this.stop) return;
                        this.stop = true;
                        log('Sending stop signal to server');
                        this.socket.send(
                            JSON.stringify({
                                type: 'stop',
                            })
                        );

                    }
                }, this.debounceDelay);
            });

            const observerConfig = {
                childList: true,
                subtree: true,
                characterData: true,
            };
            this.observer.observe(document.body, observerConfig);
            log('MutationObserver is now observing');
        }

        sendHeartbeat() {
            if (this.socket.readyState === WebSocket.OPEN) {
                log('Sending heartbeat');
                this.socket.send(JSON.stringify({ type: 'heartbeat' }));
            } else {
                log('Cannot send heartbeat, WebSocket not open');
            }
        }

        connect() {
            log('Attempting to connect to WebSocket server at:', WS_URL);
            this.socket = new WebSocket(WS_URL);
            this.socket.onopen = () => {
                log('WebSocket connection opened');
                if (this.dom) {
                    this.dom.innerHTML = '<div style="color: green;">API Connected!</div>';
                }
                this.reconnectInterval = 2000; // Reset reconnection interval
            };
            this.socket.onclose = () => {
                log('WebSocket connection closed');
                if (this.dom) {
                    this.dom.innerHTML = '<div style="color: red;">API Disconnected!</div>';
                }

                // Attempt to reconnect with exponential backoff
                setTimeout(() => {
                    log('Attempting to reconnect...');
                    this.connect();
                    this.reconnectInterval = Math.min(this.reconnectInterval * 2, this.maxReconnectInterval);
                }, this.reconnectInterval);
            };
            this.socket.onerror = (error) => {
                log('WebSocket encountered error:', error);
                if (this.dom) {
                    this.dom.innerHTML = '<div style="color: red;">API Error!</div>';
                }
            };
            this.socket.onmessage = (event) => {
                log('WebSocket message received:', event.data);
                try {
                    const data = JSON.parse(event.data);
                    log('Parsed message data:', data);
                    this.currentRequestId = data.id; // Store the request ID
                    this.start(data);
                } catch (error) {
                    log('Error parsing WebSocket message:', error);
                }
            };
        }

        init() {
            window.addEventListener('load', () => {
                log('Window loaded, initializing DOM elements');
                this.dom = document.createElement('div');
                this.dom.style =
                    'position: fixed; top: 10px; right: 10px; z-index: 9999; display: flex; justify-content: center; align-items: center;';
                document.body.appendChild(this.dom);

                this.connect();

                setInterval(() => this.sendHeartbeat(), 30000);
            });
        }
    }

    // Initialize the app
    const app = new App();
    app.init();

})();
