import http from 'http'

/**
 * The Skip The DevOps platform provides http endpoints on the same EC2 instance that your docker
 * container is running.  The endpoints are listed below and are indicated by environment variables
 * of the same name.
 * 
 * SDO_STOP_URL - This endpoint will provide a JSON serialized boolean which is set to true if your
 *  application needs to stop.  Any active requests or jobs should be completed as quickly as 
 *  possible and the application should then close.  This can occur for a variety of reasons,
 *  which are explained on the Skip The DevOps website.
 * 
 * SDO_CREDENTIALS_URL - Allows you to get AWS access keys to any roles that you have specified
 *  should be provided to your application during runtime.  You can specify which roles should be 
 *  provided in the process setup screen in your portal on the Skip The DevOps website.
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

    protected fetchUrl<T>(url: string | null | undefined): Promise<T | null> {
        return new Promise<T | null>((resolve) => {
            if (url == null) {
                // We are running outside the Skip The DevOps environment, so just continue on
                resolve(null)
            } else {
                const request = http.request(new URL(url), (response) => {
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
                                console.error(`There was an error parsing the response from Skip The DevOps at ${url}`)
                                resolve(null)
                            }
                        }
                    })
                })
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
    private timeoutHandle: NodeJS.Timer | null = null
    private shouldStopCallback: () => void

    private static stopPollIntervalMs = 5000

    constructor(shouldStopCallback: () => void) {
        super()
        this.shouldStopCallback = shouldStopCallback
    }
    
    override async initialize(): Promise<void> {
        this.timeoutHandle = setInterval(async () => {
            const response = await this.fetchUrl<boolean>(process.env.SDO_STOP_URL)
            if (response != null && response) {
                this.shouldStopCallback()
            }
        }, StopProvider.stopPollIntervalMs)
    }

    override destroy() {
        if (this.timeoutHandle != null) {
            clearInterval(this.timeoutHandle)
        }
    }
}

/**
 * Optional provider that updates AWS credentials
 */
export class CredentialProvider extends Provider {
    private readonly credentialTimeBufferMs = 1 * 60 * 1000
    private readonly minPollingIntervalMs = 1 * 60 * 1000
    private timeoutHandle: NodeJS.Timeout | null = null

    /**
     * This key needs to match the key you specified when setting up the role mapping on the
     * Skip The DevOps website process setup screen.
     */
    private static readonly credentialsKey = "AwsAccess"

    override async initialize(): Promise<void> {
        const credentials = await this.fetchUrl<Record<string, Credentials>>(
            process.env.SDO_CREDENTIALS_URL
        )
        if (credentials == null) {
            // We are running locally so just continue on
            return
        }

        // Set the credentials
        const clientAccessCredentials = credentials[CredentialProvider.credentialsKey]
        if (clientAccessCredentials == null) {
            console.error("Missing aws credentials")
            return
        }
        process.env.AWS_ACCESS_KEY_ID = clientAccessCredentials.accessKeyId
        process.env.AWS_SECRET_ACCESS_KEY = clientAccessCredentials.secretAccessKey
        process.env.AWS_SESSION_TOKEN = clientAccessCredentials.sessionToken
        process.env.AWS_DEFAULT_REGION = clientAccessCredentials.region

        // Prepare for the next pull
        const nowMs = (new Date()).getTime()
        const expirationDate = new Date(clientAccessCredentials.expiration)
        let msTillExpiration = expirationDate.getTime() - nowMs - this.credentialTimeBufferMs
        if (msTillExpiration < this.minPollingIntervalMs) {
            msTillExpiration = this.minPollingIntervalMs
        }

        this.timeoutHandle = setTimeout(() => this.initialize(), msTillExpiration)
    }

    override destroy() {
        if (this.timeoutHandle != null) {
            clearTimeout(this.timeoutHandle)
        }
    }
}

type Credentials = {
    accessKeyId: string,
    secretAccessKey: string,
    sessionToken: string,
    region: string,
    expiration: Date
}