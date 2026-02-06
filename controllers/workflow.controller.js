import dayjs from 'dayjs'

import {createRequire} from 'module'
const require = createRequire(import.meta.url)
const {serve} = require('@upstash/workflow/express')

import Subscription from "../models/subscription.model.js";
import {sendReminderEmail} from "../utils/send-email.js";

const REMINDERS = [7, 5, 2, 1]


export const sendReminders  = serve(async(context) => {
    const { subscriptionId } = context.requestPayload;
    const subscription = await fetchSubscription(context, subscriptionId)

    if(!subscription || subscription.status !== 'active') return

    const renewalDate = dayjs(subscription.renewalDate)

    if(renewalDate.isBefore(dayjs())) {
        console.log(`Renewal date had passed for subscription ${subscriptionId}. Stopping workflow.`)
        return
    }

    for(const daysBefore of REMINDERS) {
        const reminderDate = renewalDate.subtract(daysBefore, 'day')

        console.log(`Checking reminder for ${daysBefore} days before (Date: ${reminderDate.format()}, Current: ${dayjs().format()})`)

        if(reminderDate.isAfter(dayjs())) {
            await sleepUntilReminder(context, `${daysBefore} days before`, reminderDate)
        }

        await triggerReminder(context, `${daysBefore} days before reminder`, subscription)
    }
})

const fetchSubscription = async (context, subscriptionId) => {
    return await context.run('get subscription', async () => {
        return Subscription.findById(subscriptionId).populate('user', 'name email');
    })
}

const sleepUntilReminder = async (context, label, date) => {
    console.log(`Sleeping until ${label} reminder at ${date}`)
    await context.sleepUntil(label, date.toDate())
}

const triggerReminder = async (context, label, subscription) => {
    console.log(`Entering triggerReminder for ${label}`);
    return await context.run(label, async () => {
        console.log(`Triggering ${label} reminder`);

        await sendReminderEmail({
            to: subscription.user.email,
            type: label,
            subscription,
        })
    })
}