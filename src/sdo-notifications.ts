import http from 'http'
import https from 'https'

/**
 * The Skip The DevOps platform provides http and https endpoints on the same EC2 instance that your
 * docker container is running.  The endpoints are listed below and are indicated by environment
 * variables of the same name.
 * 
 * SDO_STOP_URL - This endpoint will provide a JSON serialized named boolean which is set to true
 *  if your application needs to stop.  If it is true, any active requests or jobs should be
 *  completed as quickly as possible and the application should then close.  This can occur for a
 *  variety of reasons, which are explained on the Skip The DevOps website.
 * 
 * SDO_CREDENTIALS_URL - Allows you to get AWS access keys to any roles that you have specified
 *  should be provided to your application during runtime.  You can specify which roles should be 
 *  provided in the application creation/edit screen in your portal on the Skip The DevOps website.
 */

export class SdoNotifications {
    private shouldStopCallback: (() => void) | undefined
    private stopNeeded: boolean = false
    private allProviders: Provider[] | undefined

    constructor(stopNotification?: (() => void)) {
        this.shouldStopCallback = stopNotification
    }

    /**
     * Initializes the link to the Skip The DevOps systems.  You can pass in a list of
     * optional providers to customize which integrations you want to make use of.
     * The StopProvider is private to this file and is always included by default.
     * 
     * @param providers A list of providers that you want to make use of
     */
    async initialize(providers?: Provider[]) {
        this.allProviders = [
            ...providers ?? [],
            new StopProvider(() => {
                this.stopNeeded = true
                if (this.shouldStopCallback != null) {
                    this.shouldStopCallback()
                }
            })
        ]

        const allPromises = this.allProviders.map(x => x.initialize())
        return Promise.allSettled(allPromises)
    }

    stop() {
        this.allProviders?.forEach((x) => x.destroy())
    }

    shouldStop(): boolean {
        return this.stopNeeded
    }
}

/**
 * Private class which all providers inherit from.  Proves both the common interface and
 * the ability to perform Http GET requests to the Skip The DevOps interface.
 */
abstract class Provider {
    abstract initialize(): Promise<void>
    abstract destroy(): void
    abstract getRequestFunction(): typeof http.request | typeof https.request

    protected fetchUrl<T>(url: string | null | undefined): Promise<T | null> {
        return new Promise<T | null>((resolve) => {
            if (url == null) {
                // We are running outside the Skip The DevOps environment, so just continue on
                resolve(null)
            } else {
                const request = this.getRequestFunction()(
                    new URL(url), 
                    {
                        // This is required for the https call since the https certificate is self signed.
                        // It does noting for the http call so can safely be included for both.
                        rejectUnauthorized: false
                    },
                    (response) => {
                        const statusCode = response.statusCode ?? 0
                        if (statusCode < 200 || statusCode >= 300) {
                            console.error(`Calling the Skip The DevOps systems at ${url} failed with status code ${statusCode}.`)
                            resolve(null)
                        }

                        let data = ""
                        response.on("data", (chunk) => {
                            data += chunk.toString("utf-8")
                        })
                        response.on("end", async () => {
                            if (statusCode >= 200 && statusCode < 300) {
                                try {
                                    const response = JSON.parse(data)
                                    resolve(response)
                                } catch (e) {
                                    console.error(`There was an error parsing the response from Skip The DevOps.`)
                                    resolve(null)
                                }
                            }
                        })
                    }
                )
                request.on("error", (e) => {
                    console.error(`There was a problem calling ${url} from the Skip The DevOps systems. ${e}`)
                    resolve(null)
                })
                request.end()
            }
        })
    }
}

class StopProvider extends Provider {
    private timeoutHandle: NodeJS.Timeout | null = null
    private shouldStopCallback: () => void

    private static stopPollIntervalMs = 5000    // 5 seconds

    constructor(shouldStopCallback: () => void) {
        super()
        this.shouldStopCallback = shouldStopCallback
    }
    
    override async initialize(): Promise<void> {
        // Start up a timer that will poll the stop endpoint
        this.timeoutHandle = setInterval(async () => {
            const response = await this.fetchUrl<{stop: boolean}>(process.env.SDO_STOP_URL)
            if (response != null && response.stop) {
                console.log("Stop requested")
                this.shouldStopCallback()
            }
        }, StopProvider.stopPollIntervalMs)
    }

    override destroy() {
        if (this.timeoutHandle != null) {
            clearInterval(this.timeoutHandle)
        }
    }

    override getRequestFunction(): typeof http.request | typeof https.request {
        return http.request
    }
}

/**
 * Provider that updates AWS credentials
 */
export class CredentialProvider extends Provider {
    // The extra time before credential expiration we want to get a fresh set of credentials.
    // This must be less than 5 minutes.
    private readonly credentialTimeBufferMs = 60 * 1000     //1 minute

    private timeoutHandle: NodeJS.Timeout | null = null

    /**
     * This key needs to match the key you specified when setting up the role mapping on the
     * Skip The DevOps website process setup screen.
     * 
     * You could provide multiple keys to your application which map to seperate roles if your
     * IAM roles are set up that way.  In this example, we just show a single role setup.
     */
    private static readonly credentialsKey = "AwsAccess"

    override async initialize(): Promise<void> {
        const response = await this.fetchUrl<{
            expirationEpoch: number,
            credentials: Record<string, Credentials>
        }>(
            process.env.SDO_CREDENTIALS_URL
        )
        if (response == null) {
            // We are running locally so just continue on
            console.log(`Local run detected when trying to retrieve AWS credentials.`)
            return
        }

        // Set the credentials
        //
        // Not that we are setting the environment variables that are typically used
        // for the AWS SDK in this example but you will likely want to actively replace
        // and open clients which would have already read these values into memory and
        // will need to be re-created.
        const clientAccessCredentials = response.credentials[CredentialProvider.credentialsKey]
        if (clientAccessCredentials == null) {
            console.error(`Missing aws credentials for role ${CredentialProvider.credentialsKey}`)
            return
        }
        console.log(`Setting credentials for role ${CredentialProvider.credentialsKey}`)
        process.env.AWS_ACCESS_KEY_ID = clientAccessCredentials.accessKeyId
        process.env.AWS_SECRET_ACCESS_KEY = clientAccessCredentials.secretAccessKey
        process.env.AWS_SESSION_TOKEN = clientAccessCredentials.sessionToken
        process.env.AWS_DEFAULT_REGION = clientAccessCredentials.region

        // Prepare for the next pull
        const nowMs = (new Date()).getTime()
        const expirationDate = new Date(response.expirationEpoch)
        const msTillExpiration = expirationDate.getTime() - nowMs - this.credentialTimeBufferMs

        this.timeoutHandle = setTimeout(() => this.initialize(), msTillExpiration)
    }

    override destroy() {
        if (this.timeoutHandle != null) {
            clearTimeout(this.timeoutHandle)
        }
    }

    override getRequestFunction(): typeof http.request | typeof https.request {
        return https.request
    }
}

type Credentials = {
    accessKeyId: string,
    secretAccessKey: string,
    sessionToken: string,
    region: string
}