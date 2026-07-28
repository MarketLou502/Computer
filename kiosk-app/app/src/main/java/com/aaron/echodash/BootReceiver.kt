package com.aaron.echodash

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Launches the dashboard on boot. This is the only auto-launch mechanism —
 * MainActivity is a normal app, not a HOME/launcher replacement, so nothing
 * else brings it to the foreground automatically.
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
