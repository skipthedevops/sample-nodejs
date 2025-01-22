import { CredentialProvider, SdoNotifications } from "./sdo-notifications"

/**
 * This main function simply runs in an infinite loop, printing out a line of logging
 * every minute.  The SdoNotifications class is used to communicate with the
 * Skip The DevOps systems and lets the main loop know when to shut down.
 * 
 * @returns A promise that runs in a loop until the application is told to stop by the 
 *  Skip The DevOps system.
 */

export const main = () => {
    console.log("Starting up")
    return new Promise<void>(async (resolve) => {
        // Initialize the sdo notification listener
        const sdoNotification = new SdoNotifications()

        // Include if you don't need extra AWS roles.
        //await sdoNotification.initialize()

        // Include if you do need extra AWS roles.
        await sdoNotification.initialize([new CredentialProvider()])

        // Setup the log throttle variable
        let nextLogTime = new Date()
        nextLogTime.setMinutes(nextLogTime.getMinutes() + 1)

        // Loop until we are asked to stop
        while (!sdoNotification.shouldStop()) {
            await wait()

            // See if we should log a message
            const now = new Date()
            if (now.getTime() >= nextLogTime.getTime()) {
                console.log(`Still running at ${now.toLocaleString()}`)
                nextLogTime = now
                nextLogTime.setMinutes(nextLogTime.getMinutes() + 1)
            }
        }

        // Tell the sdo notification listener to stop listening
        sdoNotification.stop()
        console.log("Shutting down")
        resolve()
    })
}

const wait = async () => {
    // We are only waiting 5 seconds because we want to check the "shouldStop" function
    // often to that we shut down promptly when asked to do so.
    await new Promise((resolve) => setTimeout(resolve, 5 * 1000))
}

main()