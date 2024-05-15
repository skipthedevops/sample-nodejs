/**
 * This main function simply runs in an infinite loop, printing out a line of logging
 * every 10 seconds until.  The SdoNotifications class is used to communicate with the
 * Skip The DevOps systems and lets the main loop know when to shut down.
 * 
 * @returns A promise that runs in a loop until the application is told to stop by the 
 *  Skip The DevOps system.
 */

import { SdoNotifications } from "./sdo-notifications"

export const main = () => {
    return new Promise<void>(async (resolve) => {
        const sdoNotification = new SdoNotifications()
        await sdoNotification.initialize()
        while (!sdoNotification.shouldStop()) {
            console.log("Running...")
            await wait()
        }
        sdoNotification.stop()
        resolve()
    })
}

const wait = async () => {
    await new Promise((resolve) => setTimeout(resolve, 10 * 1000))
}

main()