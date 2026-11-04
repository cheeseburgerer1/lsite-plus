function ConfigureTimedHeralds(Game) {
/* COOKIECLICKER_TIMED_HERALDS_START */
(function () {
    var minimum = 62;
    var maximum = 81;
    var period = 30 * 60 * 1000;
    var cycle = (maximum - minimum) * 2;

    // A shared wall-clock schedule prevents reloads from rerolling the bonus.
    Game.timedHeraldCount = function (time) {
        var step = Math.floor(time / period);
        var phase = ((step % cycle) + cycle) % cycle;
        return minimum + Math.min(phase, cycle - phase);
    };

    Game.UpdateHeralds = function () {
        clearTimeout(Game.heraldsTimer);
        var now = Date.now();
        var count = Game.timedHeraldCount(now);
        if (Game.heralds !== count) {
            Game.heralds = count;
            Game.recalculateGains = 1;
        }
        var counter = l('heraldsAmount');
        if (counter) counter.textContent = count;
        Game.externalDataLoaded = true;
        Game.heraldsTimer = setTimeout(Game.UpdateHeralds, period - ((now % period + period) % period) + 1);
    };

    // Refresh immediately after sleep or a background-tab timer delay.
    AddEvent(window, 'focus', function () { Game.UpdateHeralds(); });
    AddEvent(document, 'visibilitychange', function () {
        if (!document.hidden) Game.UpdateHeralds();
    });
})();
/* COOKIECLICKER_TIMED_HERALDS_END */
}
