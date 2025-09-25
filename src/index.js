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

// Función para registrar una persona individual
async function registerPerson(personData, index, total) {
    const {
        apellidoPat,
        apellidoMat,
        nombre1,
        nombre2,
        fotografia,
        observacion
    } = personData

    console.log(`\n🔄 [${index}/${total}] Procesando: ${nombre1} ${apellidoPat} ${apellidoMat}`)

    // Construir nombre completo
    const fullName = `${nombre1}${nombre2 ? ' ' + nombre2 : ''}`
    const fullLastName = `${apellidoPat}${apellidoMat ? ' ' + apellidoMat : ''}`

    // Procesar imagen si existe
    let faceData = null
    if (fotografia) {
        const imagePath = path.join(process.cwd(), 'src', 'extracted_images', fotografia)
        faceData = await imageToBase64(imagePath)

        if (!faceData) {
            console.warn(`⚠️  No se pudo cargar la imagen: ${fotografia}`)
        }
    }

    try {
        // 1. Registrar persona
        const personPayload = {
            personCode: String(1000000 + index).padStart(7, '0'), // Código único de 7 dígitos
            personFamilyName: fullLastName,
            personGivenName: fullName,
            gender: 1, // Por defecto masculino, ajustar según necesidad
            orgIndexCode: '68',
            phoneNo: '',
            email: '',
            faces: faceData ? [{ faceData }] : []
        }

        console.log(`📝 Registrando persona en sistema...`)
        const personResult = await queryArtemis(
            'POST',
            '/artemis/api/resource/v1/person/single/add',
            personPayload
        )

        if (personResult.code !== '0') {
            console.error(`❌ Error al registrar persona ${fullName}:`, personResult.msg)
            return { success: false, error: personResult.msg, person: fullName }
        }

        console.log(`✅ Persona registrada con ID: ${personResult.data}`)

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

            console.log(`📸 Agregando foto...`)
            const faceResult = await queryArtemis(
                'POST',
                '/artemis/api/frs/v1/face/single/addition',
                payloadFaceAddition
            )

            if (faceResult.code !== '0') {
                console.warn(`⚠️  Error al agregar foto para ${fullName}:`, faceResult.msg)
                return {
                    success: true,
                    personId: personResult.data,
                    person: fullName,
                    faceError: faceResult.msg
                }
            }

            console.log(`✅ Foto agregada exitosamente`)
        }

        return {
            success: true,
            personId: personResult.data,
            person: fullName,
            hasFace: !!faceData
        }

    } catch (error) {
        console.error(`❌ Error procesando ${fullName}:`, error.message)
        return { success: false, error: error.message, person: fullName }
    }
}

// Función principal
async function main() {
    console.log('🚀 Iniciando registro masivo en HikConnect...\n')

    try {
        // Leer datos del Excel
        const excelData = await readExcelData()
        const totalRecords = excelData.data.length

        if (totalRecords === 0) {
            console.log('⚠️  No hay registros para procesar')
            return
        }

        // Estadísticas de procesamiento
        const stats = {
            total: totalRecords,
            success: 0,
            errors: 0,
            withPhoto: 0,
            withoutPhoto: 0,
            errorDetails: []
        }

        console.log(`📋 Iniciando procesamiento de ${totalRecords} registros...\n`)
        console.log('='.repeat(60))

        // Conexión a la base de datos
        const client = await pool.connect()

        // Procesar cada registro
        for (let i = 0; i < excelData.data.length; i++) {
            const row = excelData.data[i]

            // Mapear datos del Excel según los headers encontrados
            // [No, APELLIDO_PAT, APELLIDO_MATERNO, NOMBRE_1, NOMBRE_2, FECHA_NACIMIENTO, ALIAS, OBSERVACION, FOTOGRAFIA]
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

            // Validar datos mínimos
            if (!personData.nombre1 || !personData.apellidoPat) {
                console.warn(`⚠️  [${i + 1}/${totalRecords}] Registro ${personData.numero} omitido: faltan nombre o apellido`)
                stats.errors++
                continue
            }

            // MODO PRUEBA - Mostrar datos que se registrarían
            console.log('📋 DATOS A REGISTRAR:')
            console.log('='.repeat(40))
            console.log(JSON.stringify(personData, null, 2))
            console.log('📝 Código que se generaría:', String(1000000 + (i + 1)).padStart(7, '0'))
            console.log('👤 Nombre completo:', `${personData.nombre1}${personData.nombre2 ? ' ' + personData.nombre2 : ''} ${personData.apellidoPat}${personData.apellidoMat ? ' ' + personData.apellidoMat : ''}`)
            console.log('📸 Imagen:', personData.fotografia || 'Sin imagen')
            console.log('='.repeat(40))

            // Simular resultado para estadísticas
            const result = {
                success: true,
                hasFace: !!personData.fotografia,
                person: `${personData.nombre1} ${personData.apellidoPat}`
            }

            // DESCOMENTA ESTA SECCIÓN CUANDO QUIERAS HACER EL REGISTRO REAL:
            // const result = await registerPerson(personData, i + 1, totalRecords)

            // INSERT en la base de datos local tdetenido
            const idInsertDetenido = await insertTDetenido(
                client,
                {
                    snombre: `${personData.nombre1} ${personData.nombre2}`.trim(),
                    sapellidopaterno: personData.apellidoPat,
                    sapellidomaterno: personData.apellidoMat,
                    salias: personData.alias
                }
            )

            // INSERT en la base de datos local tdetalledetencion
            const idDetalleDetencion = await insertTDetalleDetencion(
                client,
                {
                    iiddetenido: idInsertDetenido.iiddetenido,
                    sremision: '00000',
                    dtfecha: 'NOW()',
                    shora: '00:00',
                    stipoevento: 'DISPOSICIÓN',
                    sfundamento: '',
                    sconsistente: personData.observacion,
                    saliasdetencion: personData.alias,
                    iedad: 0,
                }
            )

            if (result.success) {
                stats.success++
                if (result.hasFace) {
                    stats.withPhoto++
                } else {
                    stats.withoutPhoto++
                }
            } else {
                stats.errors++
                stats.errorDetails.push({
                    person: result.person,
                    error: result.error
                })
            }

            // Pausa entre registros para no saturar la API
            await new Promise(resolve => setTimeout(resolve, 1000))
        }

        // Mostrar estadísticas finales
        console.log('\n' + '='.repeat(60))
        console.log('📊 RESUMEN DE PROCESAMIENTO:')
        console.log('='.repeat(60))
        console.log(`✅ Registros exitosos: ${stats.success}/${stats.total}`)
        console.log(`📸 Con fotografía: ${stats.withPhoto}`)
        console.log(`👤 Sin fotografía: ${stats.withoutPhoto}`)
        console.log(`❌ Errores: ${stats.errors}`)

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
    }
}

// Ejecutar el programa principal
main().catch(error => {
    console.error('💥 Error no controlado:', error)
    process.exit(1)
})