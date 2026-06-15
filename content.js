// content.js

const MAX_EMPTY_SCROLLS = 3;

/* -------------------------------------------------------------------------- */
/* Message Handling                                                           */
/* -------------------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message)
        .then(sendResponse)
        .catch(error => {
            sendResponse({
                success: false,
                error: error.message
            });
        });

    return true;
});

async function handleMessage(message) {
    switch (message?.action) {
        case "CHECK_MEMBERS_PAGE":
            return {
                success: true,
                isMembersPage: isMembersPage()
            };

        case "SCAN_VISIBLE_MEMBERS":
            return {
                success: true,
                members: extractVisibleMembers()
            };

        case "WAIT_FOR_MEMBER_UPDATE":
            await waitForMemberListUpdate();
            return {
                success: true
            };

        case "SCROLL_MEMBERS":
            return {
                success: true,
                changed: await scrollForMoreMembers()
            };

        case "PREVIEW_MESSAGE":
            return {
                success: true,
                message: personalizeTemplate(
                    message.template,
                    message.member
                )
            };

        case "SEND_MESSAGE":
            return await executeProfileMessaging(
                message.template,
                message.member
            );

        default:
            return {
                success: false,
                error: "Unknown content action."
            };
    }
}

/* -------------------------------------------------------------------------- */
/* Members Page Detection                                                     */
/* -------------------------------------------------------------------------- */

function isMembersPage() {
    const url = window.location.href.toLowerCase();

    return (
        url.includes("/members") ||
        document.body.innerText.includes("Members")
    );
}

/* -------------------------------------------------------------------------- */
/* Member Discovery                                                           */
/* -------------------------------------------------------------------------- */

function extractVisibleMembers() {
    const members = [];

    const links = Array.from(
        document.querySelectorAll('a')
    ).filter(link => {
        if (!link.href) return false;
        
        // As seen in the screenshot, members in a group list almost always have this URL pattern:
        // https://www.facebook.com/groups/[groupID]/user/[userID]/
        // or occasionally a direct profile link.
        const isMemberUrl = /\/user\/\d+/.test(link.href) || /\/profile\.php\?id=\d+/.test(link.href);
        return isMemberUrl;
    });

    const seen = new Set();

    for (const link of links) {
        const member = extractMemberFromLink(link);

        if (!member) {
            continue;
        }

        if (seen.has(member.profileUrl)) {
            continue;
        }

        seen.add(member.profileUrl);

        members.push(member);
    }

    return members;
}

function extractMemberFromLink(link) {
    const profileUrl = normalizeFacebookUrl(link.href);

    if (!profileUrl) {
        return null;
    }

    // Use innerText if available, otherwise textContent.
    // This avoids picking up visually hidden text like screen reader tags.
    const fullName = (link.innerText || link.textContent || "")
        .trim()
        .replace(/\s+/g, " ");

    if (!fullName) {
        return null;
    }

    const firstName = extractFirstName(fullName);

    return {
        fullName,
        firstName,
        profileName: fullName,
        profileUrl
    };
}

function normalizeFacebookUrl(url) {
    try {
        const parsed = new URL(url);

        if (!parsed.hostname.includes("facebook.com")) {
            return null;
        }

        parsed.search = "";
        parsed.hash = "";

        return parsed.toString();
    } catch {
        return null;
    }
}

function extractFirstName(fullName) {
    if (!fullName) {
        return "there";
    }

    const first = fullName.split(/\s+/)[0];

    return first || "there";
}

/* -------------------------------------------------------------------------- */
/* Template Personalization                                                   */
/* -------------------------------------------------------------------------- */

function personalizeTemplate(template, member) {
    return template
        .replaceAll(
            "{first_name}",
            member.firstName || "there"
        )
        .replaceAll(
            "{full_name}",
            member.fullName || ""
        )
        .replaceAll(
            "{profile_name}",
            member.profileName || member.fullName || ""
        );
}

/* -------------------------------------------------------------------------- */
/* Profile Messaging Actions                                                  */
/* -------------------------------------------------------------------------- */

async function executeProfileMessaging(template, member) {
    try {
        const textToType = personalizeTemplate(template, member);
        
        // 1. Find the Message Button
        const messageBtn = await waitForElement('div[aria-label="Message"][role="button"], a[aria-label="Message"]', 5000);
        
        if (!messageBtn) {
            return { success: false, error: "Message button not found on this profile (might be locked)." };
        }

        // Click the message button
        messageBtn.click();

        // 2. Wait for Chat Box to appear
        const chatBox = await waitForElement('div[role="textbox"][contenteditable="true"]', 5000);

        if (!chatBox) {
            return { success: false, error: "Messenger chat box did not open." };
        }

        // Focus the chat box
        chatBox.focus();
        chatBox.click();
        
        await sleep(500); // Give React a moment to focus

        // 3. Type the message
        // Using execCommand is the most reliable way to type in a React contenteditable
        const success = document.execCommand('insertText', false, textToType);
        
        if (!success) {
            // Fallback to textContent + input event
            chatBox.textContent = textToType;
            chatBox.dispatchEvent(new Event('input', { bubbles: true }));
        }

        await sleep(500); // Wait for text to register

        // 4. Send the message (simulate Enter key)
        const enterEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13
        });
        
        chatBox.dispatchEvent(enterEvent);

        await sleep(1000); // Give it time to send

        // 5. Try to close the chat box to keep the UI clean
        const closeBtn = document.querySelector('div[aria-label="Close chat"][role="button"]');
        if (closeBtn) closeBtn.click();

        return { success: true };

    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function waitForElement(selector, timeoutMs) {
    const start = Date.now();
    
    while (Date.now() - start < timeoutMs) {
        const el = document.querySelector(selector);
        if (el) return el;
        await sleep(200);
    }
    return null;
}

/* -------------------------------------------------------------------------- */
/* Infinite Scroll Support                                                    */
/* -------------------------------------------------------------------------- */

async function scrollForMoreMembers() {
    const before = document.body.scrollHeight;

    window.scrollBy({
        top: window.innerHeight,
        behavior: "smooth"
    });

    return new Promise(resolve => {
        let localObserver = null;
        
        const timeout = setTimeout(() => {
            cleanup(false);
        }, 5000);

        localObserver = new MutationObserver(() => {
            const after = document.body.scrollHeight;

            if (after > before) {
                cleanup(true);
            }
        });

        localObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        function cleanup(changed) {
            clearTimeout(timeout);

            if (localObserver) {
                localObserver.disconnect();
                localObserver = null;
            }

            resolve(changed);
        }
    });
}

async function waitForMemberListUpdate() {
    return new Promise(resolve => {
        let localObserver = null;

        const timeout = setTimeout(cleanup, 5000);

        localObserver = new MutationObserver(() => {
            cleanup();
        });

        localObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        function cleanup() {
            clearTimeout(timeout);

            if (localObserver) {
                localObserver.disconnect();
                localObserver = null;
            }

            resolve();
        }
    });
}

/* -------------------------------------------------------------------------- */
/* Example Pagination Pattern                                                 */
/* -------------------------------------------------------------------------- */

/*
Example usage from background:

let emptyScrolls = 0;

while (emptyScrolls < MAX_EMPTY_SCROLLS) {
    const visibleMembers = ...

    if (visibleMembers.length > 0) {
        emptyScrolls = 0;
    } else {
        const changed = await scrollForMoreMembers();

        if (!changed) {
            emptyScrolls++;
        }
    }
}

Log:
"No additional members detected."
*/

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}