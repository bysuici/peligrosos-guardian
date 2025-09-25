export async function insertTDetalleDetencion(
    client,
    {
        iiddetenido = null,
        sremision = '',
        dtfecha = null,
        shora = '',
        stipoevento = '',
        sfundamento = '',
        sconsistente = '',
        saliasdetencion = '',
        iedad = 0,
        sgradoestudio = '',
        socupacion = '',
        scalle = '',
        scolonia = '',
        sciudad_municipio = ''
    }
) {
    const query = `
        INSERT INTO tdetalledetencion(
            iiddetenido, sremision, dtfecha, shora, stipoevento, 
            sfundamento, sconsistente, saliasdetencion, iedad, 
            sgradoestudio, socupacion, scalle, scolonia, sciudad_municipio
        )
        VALUES($1, $2, COALESCE($3, CURRENT_DATE), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING iiddetalledetencion;
    `
    const values = [
        iiddetenido,
        sremision,
        dtfecha,
        shora,
        stipoevento,
        sfundamento,
        sconsistente,
        saliasdetencion,
        iedad,
        sgradoestudio,
        socupacion,
        scalle,
        scolonia,
        sciudad_municipio
    ]

    try {
        const result = await client.query(query, values)
        return result.rows[0]
    } catch (error) {
        console.error('Error al insertar en tdetalledetencion:', error.message)
        throw error
    }
}