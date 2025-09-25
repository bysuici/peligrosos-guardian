import { queryArtemis } from './utils/signature.js'
import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'
import { pool } from './connection/postgresql.config.js'
import { insertTDetenido } from './database/tdetenido.queries.js'
import { insertTDetalleDetencion } from './database/tdetalledetencion.queries.js'

// Función para convertir imagen a base64
async function imageToBase64(imagePath) {
    try {
        const imageBuffer = await fs.promises.readFile(imagePath)
        return imageBuffer.toString('base64')
    } catch (error) {
        console.error(`Error al leer imagen ${imagePath}:`, error.message)
        return null
    }
}

// Función para leer y procesar el Excel
async function readExcelData() {
    try {
        const excelPath = path.join(process.cwd(), 'src', 'docs', 'personas_extraidas.xlsx')

        // Leer el archivo como buffer
        const fileBuffer = await fs.promises.readFile(excelPath)

        // Procesar el buffer con XLSX
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
        const worksheet = workbook.Sheets[workbook.SheetNames[0]]

        // Convertir a JSON con headers
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

        // Remover la fila de headers y filtrar filas vacías
        const headers = jsonData[0]
        const dataRows = jsonData.slice(1).filter(row => row && row.length > 0 && row[0])

        console.log(`📊 Excel cargado: ${dataRows.length} registros encontrados`)

        return { headers, data: dataRows }
    } catch (error) {
        console.error('❌ Error al leer Excel:', error.message)
        throw error
    }
}

// Función para insertar datos en la base de datos local
async function insertLocalDatabase(client, personData, index) {
    try {
        // Generar remisión única
        const sremision = String(10000 + index).padStart(7, '0')

        console.log(`🗄️ Insertando en base de datos local...`)

        // 1. INSERT en tdetenido
        const detenidoData = {
            snombre: `${personData.nombre1} ${personData.nombre2 || ''}`.trim(),
            sapellidopaterno: personData.apellidoPat || '',
            sapellidomaterno: personData.apellidoMat || '',
            salias: personData.alias || '',
            ssexo: 'M', // Por defecto, ajustar según necesidades
            irepeticiones: 0
        }

        const resultDetenido = await insertTDetenido(client, detenidoData)
        console.log(`✅ Detenido insertado con ID: ${resultDetenido.iiddetenido}`)

        // 2. INSERT en tdetalledetencion
        const detalleData = {
            iiddetenido: resultDetenido.iiddetenido,
            sremision: sremision,
            dtfecha: null, // Usará CURRENT_DATE
            shora: new Date().toLocaleTimeString('es-MX', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit'
            }),
            stipoevento: 'DISPOSICIÓN',
            sfundamento: '',
            sconsistente: personData.observacion || '',
            saliasdetencion: personData.alias || '',
            iedad: 0
        }

        const resultDetalle = await insertTDetalleDetencion(client, detalleData)
        console.log(`✅ Detalle detención insertado con ID: ${resultDetalle.iiddetalledetencion}`)

        return {
            success: true,
            iiddetenido: resultDetenido.iiddetenido,
            iiddetalledetencion: resultDetalle.iiddetalledetencion,
            sremision: sremision
        }

    } catch (error) {
        console.error(`❌ Error en base de datos local:`, error.message)
        throw error
    }
}

// Función para registrar una persona en Artemis
async function registerPersonArtemis(personData, index, faceData) {
    const { nombre1, nombre2, apellidoPat, apellidoMat } = personData

    // Construir nombre completo
    const fullName = `${nombre1}${nombre2 ? ' ' + nombre2 : ''}`
    const fullLastName = `${apellidoPat}${apellidoMat ? ' ' + apellidoMat : ''}`

    try {
        // 1. Registrar persona en Artemis
        const personPayload = {
            personCode: String(1000000 + index).padStart(7, '0'),
            personFamilyName: fullLastName,
            personGivenName: fullName,
            gender: 1, // Por defecto masculino
            orgIndexCode: '68',
            phoneNo: '',
            email: '',
            faces: faceData ? [{ faceData }] : []
        }

        console.log(`🔗 Registrando persona en Artemis...`)
        const personResult = await queryArtemis(
            'POST',
            '/artemis/api/resource/v1/person/single/add',
            personPayload
        )

        if (personResult.code !== '0') {
            console.error(`❌ Error al registrar persona en Artemis:`, personResult.msg)
            throw new Error(personResult.msg)
        }

        console.log(`✅ Persona registrada en Artemis con ID: ${personResult.data}`)

        // 2. Agregar foto si existe
        if (faceData) {
            const payloadFaceAddition = {
                personIndexCode: personResult.data,
                faceGroupIndexCode: '28',
                faceInfo: {
                    personGivenName: fullName,
                    personFamilyName: fullLastName,
                    sex: 1
                },
                facePic: {
                    faceBinaryData: faceData
                }
            }

            console.log(`📸 Agregando foto a Artemis...`)
            const faceResult = await queryArtemis(
                'POST',
                '/artemis/api/frs/v1/face/single/addition',
                payloadFaceAddition
            )

            if (faceResult.code !== '0') {
                console.warn(`⚠️ Error al agregar foto en Artemis:`, faceResult.msg)
                return {
                    success: true,
                    artemisPersonId: personResult.data,
                    faceError: faceResult.msg
                }
            }

            console.log(`✅ Foto agregada exitosamente en Artemis`)
        }

        return {
            success: true,
            artemisPersonId: personResult.data,
            hasFace: !!faceData
        }

    } catch (error) {
        console.error(`❌ Error procesando Artemis:`, error.message)
        throw error
    }
}

// Función para procesar una persona individual
async function processPersonRecord(personData, index, total, client) {
    const {
        apellidoPat,
        apellidoMat,
        nombre1,
        nombre2,
        fotografia,
        observacion
    } = personData

    console.log(`\n📄 [${index}/${total}] Procesando: ${nombre1} ${apellidoPat} ${apellidoMat}`)

    // Validar datos mínimos
    if (!nombre1 || !apellidoPat) {
        throw new Error('Faltan datos mínimos: nombre1 o apellidoPat')
    }

    let localDbResult = null
    let artemisResult = null
    let faceData = null

    // **FASE 1: INSERTS EN BASE DE DATOS LOCAL**
    try {
        await client.query('BEGIN') // Iniciar transacción

        localDbResult = await insertLocalDatabase(client, personData, index)

        await client.query('COMMIT') // Confirmar transacción
        console.log('✅ Base de datos local: ÉXITO')

    } catch (dbError) {
        await client.query('ROLLBACK') // Deshacer cambios
        console.error('❌ Base de datos local: FALLÓ')
        throw new Error(`Error en BD local: ${dbError.message}`)
    }

    // **FASE 2: PROCESAMIENTO DE ARTEMIS (solo si BD local fue exitosa)**
    try {
        console.log('🚀 Base de datos local exitosa, procediendo con Artemis...')

        // Procesar imagen si existe
        if (fotografia) {
            const imagePath = path.join(process.cwd(), 'src', 'extracted_images', fotografia)
            faceData = await imageToBase64(imagePath)

            if (!faceData) {
                console.warn(`⚠️ No se pudo cargar la imagen: ${fotografia}`)
            }
        }

        artemisResult = await registerPersonArtemis(personData, index, faceData)
        console.log('✅ Artemis: ÉXITO')

    } catch (artemisError) {
        console.error('❌ Artemis: FALLÓ, pero datos locales se mantienen')
        artemisResult = {
            success: false,
            error: artemisError.message
        }
    }

    return {
        success: true, // Consideramos éxito si la BD local funcionó
        person: `${nombre1} ${apellidoPat}`,
        localDb: localDbResult,
        artemis: artemisResult,
        hasFace: !!faceData
    }
}

// Función principal
async function main() {
    console.log('🚀 Iniciando procesamiento: BD Local → Artemis\n')

    let client = null

    try {
        // Leer datos del Excel
        const excelData = await readExcelData()
        const totalRecords = excelData.data.length

        if (totalRecords === 0) {
            console.log('⚠️ No hay registros para procesar')
            return
        }

        // Conectar a la base de datos
        client = await pool.connect()
        console.log('✅ Conexión a PostgreSQL establecida')

        // Estadísticas de procesamiento
        const stats = {
            total: totalRecords,
            success: 0,
            dbErrors: 0,
            artemisErrors: 0,
            withPhoto: 0,
            withoutPhoto: 0,
            errorDetails: []
        }

        console.log(`📋 Iniciando procesamiento de ${totalRecords} registros...\n`)
        console.log('='.repeat(60))

        // Procesar cada registro
        for (let i = 0; i < excelData.data.length; i++) {
            const row = excelData.data[i]

            // Mapear datos del Excel
            const personData = {
                numero: row[0],
                apellidoPat: row[1] || '',
                apellidoMat: row[2] || '',
                nombre1: row[3] || '',
                nombre2: row[4] || '',
                fechaNacimiento: row[5],
                alias: row[6] || '',
                observacion: row[7] || '',
                fotografia: row[8] || ''
            }

            try {
                const result = await processPersonRecord(personData, i + 1, totalRecords, client)

                if (result.success) {
                    stats.success++
                    if (result.hasFace) {
                        stats.withPhoto++
                    } else {
                        stats.withoutPhoto++
                    }

                    if (!result.artemis.success) {
                        stats.artemisErrors++
                    }
                }

            } catch (error) {
                stats.dbErrors++
                stats.errorDetails.push({
                    person: `${personData.nombre1} ${personData.apellidoPat}`,
                    error: error.message
                })
                console.error(`❌ Error procesando registro ${i + 1}:`, error.message)
            }

            // Pausa entre registros
            await new Promise(resolve => setTimeout(resolve, 1500))
        }

        // Mostrar estadísticas finales
        console.log('\n' + '='.repeat(60))
        console.log('📊 RESUMEN DE PROCESAMIENTO:')
        console.log('='.repeat(60))
        console.log(`✅ Registros procesados exitosamente: ${stats.success}/${stats.total}`)
        console.log(`🗄️ Errores en base de datos local: ${stats.dbErrors}`)
        console.log(`🔗 Errores solo en Artemis: ${stats.artemisErrors}`)
        console.log(`📸 Con fotografía: ${stats.withPhoto}`)
        console.log(`👤 Sin fotografía: ${stats.withoutPhoto}`)

        if (stats.errorDetails.length > 0) {
            console.log('\n🚨 DETALLES DE ERRORES:')
            stats.errorDetails.forEach((error, index) => {
                console.log(`${index + 1}. ${error.person}: ${error.error}`)
            })
        }

        console.log('\n🎉 Procesamiento completado!')

    } catch (error) {
        console.error('💥 Error fatal en el procesamiento:', error.message)
        console.error(error.stack)
    } finally {
        // Liberar conexión
        if (client) {
            client.release()
            console.log('🔌 Conexión a PostgreSQL liberada')
        }
    }
}

// Ejecutar el programa principal
main().catch(error => {
    console.error('💥 Error no controlado:', error)
    process.exit(1)
})