import axios from 'axios'
import https from 'https'
import crypto from 'crypto'
import dotenv from 'dotenv'

dotenv.config()

const appKey = process.env.ARTEMIS_APP_KEY
const appSecret = process.env.ARTEMIS_SECRET_KEY
const artemisUrl = process.env.ARTEMIS_URL

const axiosInstance = axios.create({
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json'
    }
})

const createSignature = (method, contentType, path) => {
    const stringToSign = `${method}\napplication/json, text/plain, */*\n${contentType}\nx-ca-key:${appKey}\n${path}`
    return crypto.createHmac('sha256', appSecret).update(stringToSign).digest('base64')
}

/**
 * Función general para consultar a Artemis
 * @param {string} method - 'GET' o 'POST'
 * @param {string} path - Ruta del endpoint Artemis
 * @param {object} [payload={}] - Cuerpo del request si es POST
 * @returns {Promise<object>} - Respuesta `data` de Artemis
 */
export const queryArtemis = async (method, path, payload = {}) => {
    const signature = createSignature(method, 'application/json', path)

    const options = {
        url: `${artemisUrl}${path}`,
        method,
        headers: {
            'x-ca-key': appKey,
            'x-ca-signature': signature,
            'x-ca-signature-headers': 'x-ca-key'
        },
        data: method === 'POST' ? payload : undefined
    }

    try {
        const { data } = await axiosInstance(options)
        return data
    } catch (error) {
        console.error('Error en consulta a Artemis:', error.response?.data || error.message)
        throw new Error(error.response?.data?.msg || 'Error desconocido en Artemis')
    }
}