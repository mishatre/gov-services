type LKPErrorInfoType = {
    Код: string;
    Уров: 'Ошибка' | 'Предупреждение';
    Наим: string;
    Опис?: string;
    Контент?: string;
};

export interface LKPReceiveFileRequest {
    ФайлПакет: {
        attributes: {
            ИдТрПакет: string;
            СистОтпр?: string;
            СистПол?: string;
            ВнешИд?: string;
            ИдФайл: string;
            ИдПрилож?: string;
            РеестрНомКонт?: string;
            ДатаВрФормир: string;
            ТипПрилож: string;
            ВерсФорм: string;
            ИдОтпр: string;
            ИдПол: string;
        };
        Документ: {
            Контент: string;
        };
        Прилож: {
            Контент: string;
        };
        Вложен: ({
            attributes: {
                КонтентИд?: string;
                ВнешКонтентИд?: string;
                ИмяФайл: string;
                РазмерФайл?: string;
            };
        } & (
            | { Контент: string }
            | {
                  ОтносСсылка: {
                      КонтентИд: string;
                      ТипФХ: 'ЛКП' | 'РК';
                  };
              }
        ))[];
    };
}

export interface LKPGetProcessingResultRequest {
    ФайлЗапросРезул: {
        attributes: {
            ИдФайл: string;
            СистОтпр: string;
            СистПол: string;
            ДатаВрФормир: string;
            ВерсПрог: string;
            ВерсФорм: string;
        };
        Документ: {
            attributes: {
                ИдТрПакет: string;
            };
        };
    };
}

export interface LKPResultResponse {
    ФайлРезул: {
        attributes: {
            ИдФайл: string;
            СистОтпр: string;
            СистПол: string;
            ДатаВрФормир: string;
            ВерсПрог: string;
            ВерсФорм: string;
        };
        Документ: {
            СведФайл: {
                ИдТрПакет: string;
                ИдФайл: string;
                ИдОбъект: string;
            };
        } & (
            | { Процесс: true }
            | {
                  ОшибкиПр: {
                      ОшибкаПр: LKPErrorInfoType[];
                  };
              }
            | {
                  УспешОбр: {
                      ИдОбъект: string;
                      ИдДокЕИС: string;
                      ПредупрежденияПр?: {
                          ПредупреждениеПр: LKPErrorInfoType[];
                      };
                  };
              }
        );
    };
}
