function CookieClickerSpacebar(e) {
// Space clicks the cookie while normal text entry and controls keep their behavior.
            if ((e.code==='Space' || e.keyCode===32) && Game.ready && !Game.promptOn &&
                !Game.OnAscend && !Game.AscendTimer && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing)
            {
                var target=e.target;
                var editing=target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
                var control=target && target.closest && target.closest('button,a,[role="button"]');
                if (!editing && (!control || control.id==='bigCookie'))
                {
                    e.preventDefault();
                    Game.lastActivity=Game.time;
                    Game.ClickCookie();
                }
            }
}
