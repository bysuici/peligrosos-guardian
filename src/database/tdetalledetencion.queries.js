export async function insertTDetalleDetencion(
    client,
    {
        iiddetenido = '',
        sremision = '',
        dtfecha = '',
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
        INSERT INTO tdetalledetencion(iiddetenido, sremision, dtfecha, shora, stipoevento, sfundamento, sconsistente, saliasdetencion, iedad, sgradoestudio, socupacion, scalle, scolonia, sciudad_municipio)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING true;
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

    const result = await client.query(query, values)

    return result.rows[0]
}