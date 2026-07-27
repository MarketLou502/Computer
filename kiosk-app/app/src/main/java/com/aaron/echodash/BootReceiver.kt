package com.aaron.echodash

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Backup launch path for ROMs where registering as the default HOME app
 * doesn't reliably auto-start on boot. Harmless no-op if MainActivity is
 * already the foreground/HOME activity by the time this fires.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED) {
            val launch = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
            context.startActivity(launch)
        }
    }
}
