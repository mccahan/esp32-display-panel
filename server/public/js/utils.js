// Utility functions shared across modules

export function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Collapsible sections
export function toggleCollapsible(header) {
  const wasCollapsed = header.classList.contains('collapsed');
  header.classList.toggle('collapsed');
  const content = header.nextElementSibling;
  if (content && content.classList.contains('collapsible-content')) {
    content.classList.toggle('collapsed');
    content.classList.toggle('expanded');
    // Scroll into view when expanding
    if (wasCollapsed) {
      scrollCollapsibleIntoView(header, content);
    }
  }
}

export function expandCollapsible(header) {
  const wasCollapsed = header.classList.contains('collapsed');
  header.classList.remove('collapsed');
  const content = header.nextElementSibling;
  if (content && content.classList.contains('collapsible-content')) {
    content.classList.remove('collapsed');
    content.classList.add('expanded');
    // Scroll into view when expanding
    if (wasCollapsed) {
      scrollCollapsibleIntoView(header, content);
    }
  }
}

function scrollCollapsibleIntoView(header, content) {
  const startTime = performance.now();
  const duration = 300; // Match CSS transition duration

  function scrollStep() {
    const elapsed = performance.now() - startTime;
    const headerRect = header.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    // Total height of header + content
    const totalHeight = headerRect.height + contentRect.height;

    // Check if bottom of content is below viewport
    const bottomOverflow = contentRect.bottom - (viewportHeight - 20);

    if (bottomOverflow > 0) {
      // If whole section fits, scroll to show it all; otherwise keep header at top
      if (totalHeight <= viewportHeight - 40) {
        window.scrollBy({ top: bottomOverflow, behavior: 'auto' });
      } else if (headerRect.top > 80) {
        // Content too tall - scroll header toward top
        window.scrollBy({ top: Math.min(bottomOverflow, headerRect.top - 80), behavior: 'auto' });
      }
    }

    // Keep scrolling during the animation
    if (elapsed < duration) {
      requestAnimationFrame(scrollStep);
    }
  }

  requestAnimationFrame(scrollStep);
}

export function collapseCollapsible(header) {
  header.classList.add('collapsed');
  const content = header.nextElementSibling;
  if (content && content.classList.contains('collapsible-content')) {
    content.classList.add('collapsed');
    content.classList.remove('expanded');
  }
}

// Get active period index for schedule
export function getActivePeriodIndex(periods, timezone) {
  if (!periods || periods.length === 0) return -1;

  const now = new Date();
  let currentTime;
  try {
    currentTime = now.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    currentTime = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  const sortedPeriods = [...periods].map((p, i) => ({ ...p, originalIndex: i }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  let activeIndex = sortedPeriods[sortedPeriods.length - 1].originalIndex;

  for (let i = 0; i < sortedPeriods.length; i++) {
    if (sortedPeriods[i].startTime <= currentTime) {
      activeIndex = sortedPeriods[i].originalIndex;
    } else {
      break;
    }
  }

  return activeIndex;
}

// Make functions available globally for inline handlers
window.toggleCollapsible = toggleCollapsible;
window.expandCollapsible = expandCollapsible;
window.collapseCollapsible = collapseCollapsible;
