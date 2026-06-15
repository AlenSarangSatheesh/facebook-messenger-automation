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