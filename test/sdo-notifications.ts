import http from "http"

import * as assert from "assert"
import * as sinon from "sinon"

import { describe, it } from "mocha"

import { SdoNotifications } from "../src/sdo-notifications"

describe("SdoNotifications", () => {
    let httpGetStub: sinon.SinonStub

    beforeEach(() => {
        httpGetStub = sinon.stub(http, "request")
    })

    afterEach(() => {
        httpGetStub.restore()
    })

    it("Application stops", async () => {
        process.env.SDO_STOP_URL = "http://localhost/"
        let urlCalled = false
        
        httpGetStub.callsFake((url: URL, callback: any) => {
            if (url.toString() == process.env.SDO_STOP_URL) {
                callback({
                    statusCode: 200,
                    on: (eventName: string, eventCallback: any) => {
                        switch (eventName) {
                            case "data":
                                eventCallback("true")
                                break
                            case "end":
                                eventCallback()
                                urlCalled = true
                                break
                            default:
                                break
                        }
                    }
                })
            }
            return {
                on: () => {},
                end: () => {}
            }
        })
        
        const notifications = new SdoNotifications()
        await notifications.initialize()

        while (!urlCalled) {
            await wait()
        }
        assert.equal(notifications.shouldStop(), true, "should stop is true")

        notifications.stop()
    })
})

const wait = () => new Promise<void>(resolve => setTimeout(resolve, 1))